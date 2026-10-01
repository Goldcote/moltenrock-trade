// The owner's dashboard: what happened, what waits for a decision, how the portal is doing.
// Everything is rendered on the server (works without JavaScript); app.js adds the motion —
// counting numbers, live refresh of the queue and the activity feed.

import { de } from '../i18n/de';
import type { Lang, MsgKey } from '../i18n';
import { LANGS } from '../i18n';
import { htmlResponse as htmlResp, PRIVATE_HEADERS, redirect as redirectTo, withHeaders } from '../lib/http';
import { html, type Html } from '../lib/html';
import { formatMoney } from '../money/format';
import { dashboardData, type DashboardData, type FeedItem, type QueueItem } from '../domain/dashboard';
import { all, emailConfigured } from '../domain/db';
import { updateInfo } from '../lib/updates';
import { barChart, donut, icon, ring, sparkline } from './charts';
import type { Ctx } from './context';
import { page } from './layout';

const LOCALE: Record<Lang, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-CH' };
const TZ = 'Europe/Zurich';

function ago(ctx: Ctx, at: number, nowMs: number): string {
  const s = Math.max(0, (nowMs - at) / 1000);
  if (s < 60) return ctx.t('d.ago.now');
  if (s < 3600) return ctx.t('d.ago.min', { n: Math.floor(s / 60) });
  if (s < 86_400) return ctx.t('d.ago.h', { n: Math.floor(s / 3600) });
  if (s < 14 * 86_400) return ctx.t('d.ago.d', { n: Math.floor(s / 86_400) });
  return new Intl.DateTimeFormat(LOCALE[ctx.lang], { day: 'numeric', month: 'short', timeZone: TZ }).format(at);
}

const compactMoney = (lang: Lang) => (rappen: number) =>
  rappen === 0 ? '0' : new Intl.NumberFormat(LOCALE[lang], { notation: 'compact', maximumSignificantDigits: 2 }).format(rappen / 100);

function delta(cur: number, prev: number): { cls: string; text: string } | null {
  if (!prev && !cur) return null;
  if (!prev) return { cls: 'up', text: 'new' };
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { cls: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', text: `${pct > 0 ? '↑' : pct < 0 ? '↓' : '→'} ${Math.abs(pct)}%` };
}

// ---- fragments (also served on their own for live refresh) ------------------------------------

export function queueList(ctx: Ctx, d: Pick<DashboardData, 'queue' | 'now'>): Html {
  const { t } = ctx;
  if (!d.queue.length) return html`<div class="empty-state">${icon('check', 'ic big ok')}<p>${t('d.queue.clear')}</p></div>`;
  const label: Record<QueueItem['kind'], MsgKey> = { partner: 'd.queue.partner', order: 'd.queue.order', proposal: 'd.queue.proposal', prices: 'd.queue.pricesDetail' };
  return html`<ul class="queue">${d.queue.slice(0, 6).map((q) => html`<li data-id="${q.kind}-${q.id}">
    <span class="q-ic ${q.kind}">${icon(q.kind === 'order' ? 'order' : q.kind === 'partner' ? 'partner' : q.kind === 'prices' ? 'tag' : 'spark')}</span>
    <span class="q-main"><strong>${q.kind === 'prices' ? t('d.queue.prices', { n: q.title }) : q.title}</strong><small>${t(label[q.kind])}${q.detail ? ` · ${q.detail}` : ''}</small></span>
    <span class="q-side">${q.amount ? html`<b>${formatMoney(q.amount, ctx.lang)}</b>` : ''}<small>${ago(ctx, q.at, d.now)}</small></span></li>`)}</ul>
    <a class="btn block" href="/merchant/approvals">${t('d.queue.open')} ${icon('arrow')}</a>`;
}

export async function feedList(ctx: Ctx, feed: FeedItem[], nowMs: number): Promise<Html> {
  const { t } = ctx;
  if (!feed.length) return html`<p class="muted">${t('d.feed.empty')}</p>`;
  // Resolve company names for partners and orders mentioned in the feed (two small lookups).
  const partnerIds = [...new Set(feed.map((f) => /^partner:(\d+)$/.exec(f.target)?.[1]).filter(Boolean))] as string[];
  const refs = [...new Set(feed.map((f) => /^order:(MT-[A-Z0-9]+)$/.exec(f.target)?.[1]).filter(Boolean))] as string[];
  const emails = [...new Set(feed.filter((f) => f.actor_type === 'partner').map((f) => f.actor_label.replace(/^partner:/, '')))];
  const [pRows, oRows, uRows] = await Promise.all([
    partnerIds.length ? all<{ id: number; company: string }>(ctx.env.DB, `SELECT id, company FROM partners WHERE id IN (${partnerIds.map(() => '?').join(',')})`, ...partnerIds.map(Number)) : [],
    refs.length ? all<{ ref: string; company: string; total_rappen: number }>(ctx.env.DB, `SELECT o.ref, p.company, o.total_rappen FROM orders o JOIN partners p ON p.id = o.partner_id WHERE o.ref IN (${refs.map(() => '?').join(',')})`, ...refs) : [],
    emails.length ? all<{ email: string; company: string }>(ctx.env.DB, `SELECT u.email, p.company FROM partner_users u JOIN partners p ON p.id = u.partner_id WHERE u.email IN (${emails.map(() => '?').join(',')})`, ...emails) : [],
  ]);
  const company = new Map(pRows.map((r) => [`partner:${r.id}`, r.company]));
  const order = new Map(oRows.map((r) => [`order:${r.ref}`, r]));
  const byEmail = new Map(uRows.map((r) => [r.email.toLowerCase(), r.company]));
  return html`<ul class="feed">${feed.map((f) => {
    const who = f.actor_type === 'agent' ? f.actor_label.replace(/^agent:/, '')
      : f.actor_type === 'user' ? t('d.who.you')
        : f.actor_type === 'partner' ? byEmail.get(f.actor_label.replace(/^partner:/, '').toLowerCase()) ?? String(f.detail.company ?? '—')
          : t('d.who.system');
    const o = order.get(f.target);
    const x = company.get(f.target) ?? (f.detail.company as string | undefined) ?? (f.detail.name as string | undefined) ?? (typeof f.detail.lang === 'string' ? f.detail.lang.toUpperCase() : '') ?? '';
    const key = `feed.${f.action}` as MsgKey;
    const text = key in de ? t(key, { x, ref: o ? o.ref : f.target.replace(/^order:/, '') }) : f.action;
    return html`<li data-id="${f.id}" class="${f.actor_type}"><span class="f-ic">${icon(f.actor_type === 'agent' ? 'agent' : f.actor_type === 'system' ? 'clock' : f.actor_type === 'partner' ? 'partner' : 'person')}</span>
      <span class="f-main"><strong>${who}</strong> <span>${text}</span>${o && f.action === 'order.place' ? html` <b class="f-amt">${formatMoney(o.total_rappen, ctx.lang)}</b>` : ''}</span>
      <time>${ago(ctx, f.at, nowMs)}</time></li>`;
  })}</ul>`;
}

// ---- the page --------------------------------------------------------------------------------

export async function dashboardSections(ctx: Ctx, d: DashboardData, opts: { live: boolean }): Promise<Html> {
  const { t, lang } = ctx;
  const money = (r: number) => formatMoney(r, lang);
  const dm = delta(d.month.net, d.month.prevNet);
  const dn = delta(d.month.n, d.month.prevN);
  const weekFmt = new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const weeklyNet = d.weeks.map((w) => w.net);
  const avg = weeklyNet.reduce((a, b) => a + b, 0) / d.weeks.length;
  const invTotal = d.invoices.paid + d.invoices.open + d.invoices.overdue;
  const cov = d.catalog.coverage;
  const needs = d.queue.length;
  const topMax = Math.max(1, ...d.top.map((x) => x.net));
  const topPct = (v: number) => Math.max(5, Math.round((v / topMax) * 20) * 5); // 5 % steps → CSS classes w5…w100

  const kpi = (o: { label: string; ic: string; value: number; fmt: 'money' | 'int'; display: string; note: Html | string; delta?: { cls: string; text: string } | null; spark?: Html; cls?: string }) =>
    html`<article class="kpi-card ${o.cls ?? ''}" data-spot><header><span class="kpi-label">${icon(o.ic)}${o.label}</span>${o.delta ? html`<span class="delta ${o.delta.cls}" title="${t('d.vsLast')}">${o.delta.text}</span>` : ''}</header>
      <div class="kpi-value" data-count="${o.value}" data-fmt="${o.fmt}" data-locale="${LOCALE[lang]}">${o.display}</div>
      <p class="kpi-note">${o.note}</p>${o.spark ?? ''}</article>`;

  return html`
  <section class="kpi-row">
    ${kpi({ label: t('d.kpi.revenue'), ic: 'status', value: d.month.net, fmt: 'money', display: money(d.month.net), note: t('d.kpi.revenueNote'), delta: dm, spark: sparkline(weeklyNet), cls: 'primary' })}
    ${kpi({ label: t('d.kpi.orders'), ic: 'order', value: d.month.n, fmt: 'int', display: String(d.month.n), note: t('d.kpi.ordersNote', { n: d.partners.approved }), delta: dn, spark: sparkline(d.weeks.map((w) => w.n)) })}
    ${kpi({ label: t('d.kpi.open'), ic: 'clock', value: d.invoices.open + d.invoices.overdue, fmt: 'money', display: money(d.invoices.open + d.invoices.overdue),
      note: d.invoices.overdue_n ? html`<span class="bad">${t('d.kpi.overdue', { n: d.invoices.overdue_n })}</span>` : t('d.kpi.allOnTime'), cls: d.invoices.overdue_n ? 'warn' : '' })}
    ${kpi({ label: t('d.kpi.waiting'), ic: 'approvals', value: needs, fmt: 'int', display: String(needs), note: needs ? html`<a href="/merchant/approvals">${t('d.queue.open')} →</a>` : t('d.kpi.waitingNone'), cls: needs ? 'hot' : 'calm' })}
  </section>

  <section class="grid-2-1">
    <article class="panel chart-panel" data-spot><header class="panel-head"><div><h2>${t('d.chart.title')}</h2><p>${t('d.chart.sub')}</p></div>
      <div class="legend"><span class="lg bar"></span>${t('d.chart.net')}<span class="lg avg"></span>${t('d.chart.avgShort')}</div></header>
      ${weeklyNet.some((v) => v > 0)
        ? barChart(d.weeks.map((w) => ({ label: weekFmt.format(w.start), value: w.net, display: compactMoney(lang)(w.net) })), { axis: compactMoney(lang), avgLabel: t('d.chart.avg', { amount: compactMoney(lang)(avg) }) })
        : html`<div class="empty-state tall">${icon('status', 'ic big')}<p>${t('d.chart.empty')}</p></div>`}
    </article>
    <article class="panel" data-spot><header class="panel-head"><div><h2>${t('d.queue.title')}</h2><p>${needs ? t('d.queue.sub', { n: needs }) : t('d.kpi.waitingNone')}</p></div>${opts.live ? html`<span class="live-dot" title="Live"></span>` : ''}</header>
      <div ${opts.live ? html`data-poll="/merchant/live/queue"` : ''}>${queueList(ctx, d)}</div></article>
  </section>

  <section class="grid-3">
    <article class="panel" data-spot><header class="panel-head"><div><h2>${t('d.inv.title')}</h2><p>${t('d.inv.sub')}</p></div></header>
      <div class="donut-wrap">${donut([{ value: d.invoices.paid, cls: 'paid' }, { value: d.invoices.open, cls: 'open' }, { value: d.invoices.overdue, cls: 'overdue' }],
        { big: compactMoney(lang)(invTotal), small: 'CHF' })}
        <ul class="legend-list"><li><span class="lg paid"></span>${t('d.inv.paid')}<b>${money(d.invoices.paid)}</b><small>${d.invoices.paid_n}</small></li>
          <li><span class="lg open"></span>${t('d.inv.open')}<b>${money(d.invoices.open)}</b><small>${d.invoices.open_n}</small></li>
          <li><span class="lg overdue"></span>${t('d.inv.overdue')}<b>${money(d.invoices.overdue)}</b><small>${d.invoices.overdue_n}</small></li></ul></div></article>
    <article class="panel" data-spot><header class="panel-head"><div><h2>${t('d.cat.title')}</h2><p>${t('d.cat.orderable', { n: d.catalog.orderable })}${d.catalog.flagged ? ` · ${t('d.cat.flagged', { n: d.catalog.flagged })}` : ''}</p></div></header>
      <div class="rings">${LANGS.map((l) => {
        const f = cov.products ? cov.by_lang[l].present / cov.products : 0;
        return html`<figure>${ring(f, l.toUpperCase(), f >= 1 ? 'ok' : '')}<figcaption>${Math.round(f * 100)}%</figcaption></figure>`;
      })}</div><p class="muted small">${t('d.cat.texts')}</p></article>
    <article class="panel" data-spot><header class="panel-head"><div><h2>${t('d.top.title')}</h2><p>${t('d.top.sub')}</p></div></header>
      ${d.top.length ? html`<ul class="toplist">${d.top.map((c, i) => html`<li><span class="rank">${i + 1}</span><span class="t-main"><strong>${c.company}</strong><span class="meter"><span class="w${topPct(c.net)}"></span></span></span><b>${compactMoney(lang)(c.net)}</b></li>`)}</ul>`
        : html`<div class="empty-state">${icon('partner', 'ic big')}<p>${t('d.top.empty')}</p></div>`}</article>
  </section>

  <section class="grid-3-2">
    <article class="panel" data-spot><header class="panel-head"><div><h2>${t('d.orders.title')}</h2></div></header>
      ${d.recent.length ? html`<ul class="orders">${d.recent.map((o) => html`<li><span class="o-main"><strong>${o.company}</strong><small>${o.ref} · ${o.city}</small></span>
        <span class="pill ${o.state}">${t(`state.${o.state}` as MsgKey)}</span><b>${money(o.total_rappen)}</b><time>${ago(ctx, o.created_at, d.now)}</time></li>`)}</ul>`
        : html`<div class="empty-state">${icon('order', 'ic big')}<p>${t('d.orders.empty')}</p></div>`}</article>
    <article class="panel" data-spot><header class="panel-head"><div><h2>${t('d.feed.title')}</h2><p>${t('d.feed.sub')}</p></div>${opts.live ? html`<span class="live-dot" title="Live"></span>` : ''}</header>
      <div ${opts.live ? html`data-poll="/merchant/live/feed"` : ''}>${await feedList(ctx, d.feed, d.now)}</div></article>
  </section>`;
}

export async function dashboard(ctx: Ctx): Promise<Response> {
  if (!ctx.shop) return redirectTo('/merchant/signup');
  if (!ctx.viewer) return redirectTo('/login');
  if (ctx.viewer.actor.type !== 'user') return redirectTo('/catalog');
  const { t, lang } = ctx;
  const d = await dashboardData(ctx.env, ctx.baseUrl);
  const upd = await updateInfo(ctx.env);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ }).format(d.now));
  const greet = hour < 11 ? t('d.greeting.morning') : hour < 18 ? t('d.greeting.afternoon') : t('d.greeting.evening');
  const today = new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(d.now);
  const setupFrac = d.setup.total ? d.setup.done / d.setup.total : 0;
  const body = html`<div class="dash">
    <header class="dash-head">
      <div><p class="eyebrow">${today}</p><h1>${greet}<span class="shop-name">, ${ctx.shop.legal_name}</span></h1></div>
      <div class="head-actions"><span class="live-pill"><span class="live-dot"></span>Live</span>
        <a class="btn secondary" href="/" target="_blank" rel="noopener">${icon('store')}${t('m.nav.storefront')}</a></div>
    </header>
    ${!d.setup.complete ? html`<section class="setup-hero" data-spot>${ring(setupFrac, `${d.setup.done}/${d.setup.total}`, 'hero-ring')}
      <div><h2>${t('d.setup.title')}</h2><p>${t('d.setup.body', { done: d.setup.done, total: d.setup.total })}</p></div>
      <a class="btn" href="/merchant/setup">${t('d.setup.cta')} ${icon('arrow')}</a></section>` : ''}
    ${!ctx.shop.iban ? html`<aside class="hint-strip warn">${icon('clock')}<p>${t('m.iban.missing')} <a href="/merchant/setup#business">${t('m.iban.add')} →</a></p></aside>` : ''}
    ${!emailConfigured(ctx.env) ? html`<aside class="hint-strip warn">${icon('clock')}<p>${t('d.emailOff')} <a href="/merchant/setup#email">${t('d.emailFix')} →</a></p></aside>` : ''}
    ${upd.available && upd.latest ? html`<aside class="hint-strip info">${icon('download')}<p>${t('d.update', { v: upd.latest.latest })} <a href="/status#software">${t('u.how')} →</a></p></aside>` : ''}
    ${await dashboardSections(ctx, d, { live: true })}
    <aside class="molten-strip">${icon('mac')}<p>${t('d.molten')}</p></aside>
  </div>`;
  return htmlResp(page(ctx, { title: t('m.nav.dashboard'), area: 'merchant', body }));
}

/** Live fragments polled by app.js (owner/staff session required). */
export async function liveFragment(ctx: Ctx, which: string): Promise<Response> {
  if (!ctx.viewer || ctx.viewer.actor.type !== 'user') return withHeaders(new Response(null, { status: 401, headers: PRIVATE_HEADERS }));
  const d = await dashboardData(ctx.env, ctx.baseUrl);
  const frag = which === 'queue' ? queueList(ctx, d) : await feedList(ctx, d.feed, d.now);
  return withHeaders(new Response(frag.value, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...PRIVATE_HEADERS } }));
}

