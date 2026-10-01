// Read-only status page: for the signed-in owner, or via a signed one-hour link an agent hands out.
// Shows the settings (the 15 defaults) and the numbers — nothing here can change anything.

import { LANGS } from '../i18n';
import { AppError, htmlResponse, jsonResponse, readForm, redirect } from '../lib/http';
import { assertCsrf } from '../domain/auth';
import { checkForUpdates, updateInfo } from '../lib/updates';
import { csrfField } from './layout';
import { assertSameOrigin } from '../domain/auth';
import { seedDemo } from '../dev/demo';
import { html } from '../lib/html';
import { bpToPercent, formatDate, formatMoney } from '../money/format';
import { overview, setupStatus, verifyStatusLink } from '../domain/status';
import { all } from '../domain/db';
import { isDev } from '../lib/env';
import type { Ctx } from './context';
import { page } from './layout';
import { dashboardData } from '../domain/dashboard';
import { dashboardSections } from './dashboard';

/** Owner/staff: check for a newer MoltenRock Trade version right now (otherwise the cron does it daily). */
export async function updateCheckNow(ctx: Ctx): Promise<Response> {
  const v = ctx.viewer;
  if (!v || v.actor.type !== 'user') return redirect('/login');
  assertCsrf(ctx.req, v.session, await readForm(ctx.req));
  await checkForUpdates(ctx.env, { force: true });
  return redirect('/status#software');
}

export async function statusPage(ctx: Ctx): Promise<Response> {
  const signed = ctx.url.searchParams.has('sig') && (await verifyStatusLink(ctx.env, ctx.url));
  if (!signed && ctx.viewer?.actor.type !== 'user') throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  const { t } = ctx;
  const o = await overview(ctx.env);
  const setup = await setupStatus(ctx.env, ctx.baseUrl);
  const money = (r: number | null | undefined) => formatMoney(r ?? 0, ctx.lang);
  const s = o.settings;
  const cov = o.catalog.translations;
  const defaults: [string, string][] = [
    ['1 · Approval above', s.approval_threshold_rappen === null ? 'never' : s.approval_threshold_rappen === 0 ? 'every basket' : money(s.approval_threshold_rappen)],
    ['2 · Minimum order (net)', money(s.min_order_rappen)],
    ['3 · Payment terms', `Net ${s.payment_terms_days} days`],
    ['4–5 · Tiers', o.tiers.map((x) => `${x.name} −${bpToPercent(x.discount_bp)}%${x.is_default ? ' (default)' : ''}`).join(', ')],
    ['6 · VAT line', o.shop?.vat_registered ? 'shown (VAT-registered)' : 'not charged (not VAT-registered)'],
    ['7 · Carton sizes', 'per product, default none'],
    ['8 · Respect shop stock', s.respect_stock ? 'yes' : 'no — everything orderable'],
    ['9 · New products offered', s.include_new_products ? 'yes' : 'no'],
    ['10 · Fulfilment', s.fulfilment_profile === 'manual' ? 'manual' : `${s.fulfilment_profile} (dry run)`],
    ['11 · Data region', 'Cloudflare EU jurisdiction (set at deploy)'],
    ['12 · Invoices', `QR-bill, IBAN ${o.shop?.iban ?? '—'}`],
    ['Cancel window', `${s.cancel_window_minutes} min`],
    ['Language fallback', s.language_fallback.join(' → ')],
    ['Defaults confirmed', s.defaults_confirmed ? 'yes' : 'not yet'],
  ];
  const d = await dashboardData(ctx.env, ctx.baseUrl);
  return htmlResponse(page(ctx, {
    title: t('m.status.title'), area: 'merchant',
    body: html`<div class="dash"><header class="dash-head"><div><p class="eyebrow">${t('m.nav.status')}</p><h1>${t('m.status.title')}</h1><p class="lead">${t('m.status.lead')}</p></div></header>
    ${await dashboardSections(ctx, d, { live: false })}
    ${await softwarePanel(ctx)}
    <div class="split">
      <section class="card"><h2>Setup</h2><ul class="timeline">${setup.steps.map((st) => html`<li class="${st.done ? 'done' : ''}">${st.title}${st.detail && !st.done ? html` <small>${st.detail}</small>` : ''}</li>`)}</ul>
        ${setup.next_action ? html`<p class="muted">Next: ${setup.next_action.hint}</p>` : ''}</section>
      <section class="card"><h2>Settings</h2><dl class="kv">${defaults.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></section>
    </div>
    <section class="card"><h2>Product texts</h2><table><thead><tr><th>Language</th><th class="num">present</th><th class="num">imported</th><th class="num">agent</th><th class="num">human</th><th class="num">missing</th></tr></thead>
      <tbody>${LANGS.map((l) => html`<tr><td>${l.toUpperCase()}</td><td class="num">${cov.by_lang[l].present}</td><td class="num">${cov.by_lang[l].imported}</td><td class="num">${cov.by_lang[l].agent}</td><td class="num">${cov.by_lang[l].human}</td><td class="num">${Math.max(0, cov.products - cov.by_lang[l].present)}</td></tr>`)}</tbody></table></section>
    ${o.latest_fulfilment_handoff ? html`<section class="card"><h2>Latest fulfilment hand-off <span class="badge warn">DRY RUN — not sent</span></h2><pre>${JSON.stringify(o.latest_fulfilment_handoff.payload, null, 2)}</pre></section>` : ''}
    ${o.shop_connection ? html`<section class="card"><h2>Shop connection</h2><dl class="kv"><dt>Shop</dt><dd>${o.shop_connection.kind} · ${o.shop_connection.base_url} (read-only)</dd>
      <dt>Last import</dt><dd>${o.shop_connection.last_import_at ? formatDate(o.shop_connection.last_import_at, ctx.lang) : '—'}</dd></dl>
      ${o.shop_connection.last_import ? html`<pre>${JSON.stringify(o.shop_connection.last_import, null, 2)}</pre>` : ''}</section>` : ''}</div>`,
  }));
}

/** DEV only: fill the local database with twelve weeks of demo trade (see src/dev/demo.ts). */
export async function devDemo(ctx: Ctx): Promise<Response> {
  if (!isDev(ctx.env)) throw new AppError('NOT_FOUND', 'Not found', 404);
  assertSameOrigin(ctx.req);
  return jsonResponse({ ok: true, ...(await seedDemo(ctx.env)) });
}

/** DEV only: the local mailbox (the prototype never sends real email). */
export async function devMail(ctx: Ctx): Promise<Response> {
  if (!isDev(ctx.env)) throw new AppError('NOT_FOUND', 'Not found', 404);
  const mails = await all<{ id: number; to_addr: string; subject: string; body: string; created_at: number }>(ctx.env.DB, 'SELECT * FROM outbox_emails ORDER BY id DESC LIMIT 50');
  const linkify = (body: string) => body.split(/(https?:\/\/\S+)/g).map((part, i) => (i % 2 ? html`<a href="${part}">${part}</a>` : part));
  return htmlResponse(page(ctx, {
    title: 'Dev mailbox', area: 'public',
    body: html`<h1>Dev mailbox</h1><p class="muted">Local only. Nothing is sent.</p>${mails.map((m) => html`<section class="card"><small>#${m.id} · ${new Date(m.created_at).toISOString()} · to ${m.to_addr}</small><h3>${m.subject}</h3><pre>${linkify(m.body)}</pre></section>`)}`,
  }));
}

/** Version and update status (the daily check can be switched off with the update_check setting). */
async function softwarePanel(ctx: Ctx) {
  const { t } = ctx;
  const u = await updateInfo(ctx.env);
  const how = u.latest?.how_to_update_url ?? 'https://github.com/Goldcote/moltenrock-trade/blob/main/docs/UPDATING.md';
  const state = !ctx.settings.update_check ? html`<span class="pill">${t('u.off')}</span>`
    : !u.latest ? html`<span class="pill">${t('u.unknown')}</span>`
      : u.available ? html`<span class="pill awaiting_approval">${t('u.available', { v: u.latest.latest })}</span> <a href="${how}" rel="noopener">${t('u.how')} →</a>`
        : html`<span class="pill confirmed">${t('u.upToDate')}</span>`;
  const checked = u.latest ? new Intl.DateTimeFormat(ctx.lang + '-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' }).format(u.latest.checked_at) : '';
  return html`<section class="panel software" id="software"><header class="panel-head"><div><h2>${t('u.title')}</h2><p>${t('u.current', { v: u.current })} · ${state}${checked ? html` <small>(${t('u.checked', { when: checked })})</small>` : ''}</p></div>
    ${ctx.viewer?.actor.type === 'user' && ctx.settings.update_check ? html`<form method="post" action="/merchant/update-check">${csrfField(ctx)}<button class="secondary small">${t('u.checkNow')}</button></form>` : ''}</header></section>`;
}
