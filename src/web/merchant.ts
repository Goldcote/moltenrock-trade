// The merchant's only human pages: sign up, connect an agent (+ human-only business/bank details),
// and approvals. Everything else is configured by the merchant's agent over MCP.

import { LANGS, isLang, t as tr } from '../i18n';
import type { AgentScope } from '../lib/env';
import { AppError, htmlResponse, PRIVATE_HEADERS, readForm, redirect, withHeaders } from '../lib/http';
import { html, type Html } from '../lib/html';
import { bpToPercent, formatDate, formatMoney } from '../money/format';
import { assertCsrf, assertSameOrigin, createMagicLink, createSession, INVITE_LINK_TTL } from '../domain/auth';
import { emailConfigured, now, one, run } from '../domain/db';
import { isDev } from '../lib/env';
import { decideHeldOrder, listOrders } from '../domain/orders';
import { decidePartner, getPartner, listPartners } from '../domain/partners';
import { decideProposal, listProposals } from '../domain/proposals';
import { setupStatus } from '../domain/status';
import { maskIban, updateShopIdentity, validateShopIdentity, type ShopIdentityInput } from '../domain/settings';
import { SEED_TIERS, listTiers } from '../domain/tiers';
import { createAgentToken, listAgentTokens, revokeAgentToken, SCOPES } from '../domain/tokens';
import { formatIban } from '../swiss/validate';
import { decidePrices, listPricesToConfirm } from '../domain/catalog';
import { icon } from './charts';
import type { Ctx } from './context';
import { csrfField, notice, page } from './layout';

function requireOwnerOrStaff(ctx: Ctx) {
  const v = ctx.viewer;
  if (!ctx.shop) return redirect('/merchant/signup');
  if (!v) return redirect('/login');
  if (v.actor.type !== 'user') return redirect('/catalog');
  return v.actor;
}

// ---- Sign-up (only while the instance has no shop yet: single shop per instance) ------------

function signupForm(ctx: Ctx, values: Record<string, string> = {}, error?: string) {
  const { t } = ctx;
  const v = (k: string) => values[k] ?? '';
  return page(ctx, {
    title: t('m.signup.title'), area: 'merchant', narrow: true,
    body: html`<section class="card"><h1>${t('m.signup.title')}</h1><p>${t('m.signup.lead')}</p>${error ? notice('err', error) : ''}
      <form method="post" action="/merchant/signup">
        <label for="legal_name">${t('m.field.legalName')}</label><input id="legal_name" name="legal_name" type="text" required value="${v('legal_name')}">
        <div class="row r31"><div><label for="street">${t('field.street')}</label><input id="street" name="street" type="text" required value="${v('street')}"></div>
          <div><label for="house_no">${t('field.houseNo')}</label><input id="house_no" name="house_no" type="text" value="${v('house_no')}"></div></div>
        <div class="row r13"><div><label for="postcode">${t('field.postcode')}</label><input id="postcode" name="postcode" type="text" required pattern="[1-9][0-9]{3}" value="${v('postcode')}"></div>
          <div><label for="city">${t('field.city')}</label><input id="city" name="city" type="text" required value="${v('city')}"></div></div>
        <label for="email">${t('m.field.email')}</label><input id="email" name="email" type="email" required autocomplete="email" value="${v('email')}"><p class="hint">${t('m.hint.email')}</p>
        <label for="uid">${t('field.uid')}</label><input id="uid" name="uid" type="text" placeholder="CHE-123.456.789" value="${v('uid')}"><p class="hint">${t('m.hint.uid')}</p>
        <label class="check"><input type="checkbox" name="vat_registered" value="1" ${values.vat_registered ? html`checked` : ''}> ${t('m.field.vatRegistered')}</label>
        <label for="iban">${t('m.field.iban')}</label><input id="iban" name="iban" type="text" required placeholder="CH93 0076 2011 6238 5295 7" value="${v('iban')}"><p class="hint">${t('m.hint.iban')}</p>
        <label for="default_lang">${t('field.language')}</label><select id="default_lang" name="default_lang">${LANGS.map((l) => html`<option value="${l}" ${l === (values.default_lang ?? ctx.lang) ? html`selected` : ''}>${tr(l, 'lang.name')}</option>`)}</select>
        <p class="muted">${t('m.signup.after')}</p>
        <div class="actions"><button type="submit">${t('m.signup.submit')}</button></div>
      </form></section>`,
  });
}

export function signupGet(ctx: Ctx): Response {
  if (ctx.shop) return redirect(ctx.viewer?.actor.type === 'user' ? '/merchant' : '/login');
  return htmlResponse(signupForm(ctx));
}

export async function signupPost(ctx: Ctx): Promise<Response> {
  assertSameOrigin(ctx.req);
  if (ctx.shop) return redirect('/login');
  const f = await readForm(ctx.req);
  let v: ShopIdentityInput;
  try {
    v = validateShopIdentity({ ...(f as unknown as ShopIdentityInput), vat_registered: f.vat_registered === '1' });
  } catch (e) { if (e instanceof AppError) return htmlResponse(signupForm(ctx, f, e.message), { status: 400 }); throw e; }
  // Self-hosted installs can pin the owner: only OWNER_EMAIL may create the shop.
  if (ctx.env.OWNER_EMAIL && ctx.env.OWNER_EMAIL.trim().toLowerCase() !== v.email.trim().toLowerCase())
    return htmlResponse(signupForm(ctx, f, ctx.t('m.signup.ownerOnly')), { status: 403 });
  const lang = isLang(f.default_lang) ? f.default_lang : 'de';
  const ts = now();
  // One transaction: shop identity, owner and the seeded tiers (Standard −40 %, VIP −50 %).
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO shop (id, legal_name, street, house_no, postcode, city, country, email, uid, vat_registered, iban, default_lang, currency, created_at)
      VALUES (1, ?, ?, ?, ?, ?, 'CH', ?, ?, ?, ?, ?, 'CHF', ?)`).bind(v.legal_name, v.street, v.house_no ?? '', v.postcode, v.city, v.email, v.uid || null, v.vat_registered ? 1 : 0, v.iban, lang, ts),
    ctx.env.DB.prepare("INSERT INTO users (email, name, role, created_at) VALUES (?, '', 'owner', ?)").bind(v.email.toLowerCase(), ts),
    ...SEED_TIERS.map((s) => ctx.env.DB.prepare('INSERT INTO tiers (name, discount_bp, is_default, created_at) VALUES (?, ?, ?, ?)').bind(s.name, s.discount_bp, s.is_default, ts)),
  ]);
  await run(ctx.env.DB, "INSERT INTO audit_log (at, actor_type, actor_label, action, target, detail) VALUES (?, 'user', ?, 'shop.create', 'shop', '{}')", ts, `user:${v.email}`);
  // Sign the owner in straight away — no email round-trip needed to get started.
  const owner = await one<{ id: number }>(ctx.env.DB, 'SELECT id FROM users WHERE email = ?', v.email.toLowerCase());
  const { cookie } = await createSession(ctx.env, ctx.req, 'user', owner!.id);
  return redirect('/merchant/setup', { 'Set-Cookie': cookie });
}

// ---- Home: three-step setup (company details → connect your agent → "set up my trade portal") ----

const AGENT_STEPS = ['connect_shop', 'import_catalog', 'confirm_prices', 'review_flagged', 'translations', 'confirm_defaults', 'first_partner'] as const;

const isLocalHttp = (url: URL) => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/** The agent's setup steps in plain words, with ticks. Polled by /merchant/progress while the agent works. */
async function checklist(ctx: Ctx): Promise<{ list: Html; complete: boolean; shopConnected: boolean }> {
  const { t } = ctx;
  const st = await setupStatus(ctx.env, ctx.baseUrl);
  const byId = new Map(st.steps.map((s) => [s.id, s]));
  const next = AGENT_STEPS.find((id) => !byId.get(id)?.done);
  const missing = Object.entries(st.facts.missing_by_lang).filter(([, n]) => n > 0).map(([l, n]) => `${l.toUpperCase()} ${n}`).join(' · ');
  const detail = (id: string) =>
    id === 'confirm_prices' && st.facts.unconfirmed_prices > 0 ? t('setup.waiting', { n: st.facts.unconfirmed_prices })
      : id === 'review_flagged' && st.facts.flagged > 0 ? t('setup.flagged', { n: st.facts.flagged })
      : id === 'translations' && missing && byId.get('import_catalog')?.done ? t('setup.missing', { list: missing }) : '';
  const list = html`${AGENT_STEPS.map((id) => {
    const done = !!byId.get(id)?.done;
    const d = detail(id);
    return html`<li class="${done ? 'done' : id === next ? 'next' : ''}"><span class="tick" aria-hidden="true">${done ? '✓' : ''}</span>
      <span>${t(`setup.${id}` as never)}${d ? html` <small>· ${d}</small>` : ''}</span>${done ? html`<span class="sr">${t('m.done')}</span>` : ''}</li>`;
  })}`;
  return { list, complete: !next, shopConnected: !!byId.get('connect_shop')?.done };
}

export async function progress(ctx: Ctx): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return withHeaders(new Response(null, { status: 401, headers: PRIVATE_HEADERS }));
  // A fragment (no doctype): app.js swaps it into the checklist while the agent works.
  return withHeaders(new Response((await checklist(ctx)).list.value, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...PRIVATE_HEADERS } }));
}

export async function home(ctx: Ctx, extra?: { token?: string; error?: string; saved?: boolean }): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  const { t } = ctx;
  const shop = ctx.shop!;
  const tokens = await listAgentTokens(ctx.env.DB);
  const active = tokens.filter((tk) => !tk.revoked_at);
  const { list, complete, shopConnected } = await checklist(ctx);
  const mcpUrl = `${ctx.baseUrl}/mcp`;
  const isOwner = actor.role === 'owner';
  const connectCli = `claude mcp add --transport http moltenrock-trade ${mcpUrl}`;
  const keyCli = `claude mcp add --transport http moltenrock-trade ${mcpUrl} --header "Authorization: Bearer ${extra?.token ?? '<key>'}"`;
  const jsonSnippet = JSON.stringify({ mcpServers: { 'moltenrock-trade': { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${extra?.token ?? '<key>'}` } } } }, null, 2);
  const ready = complete && active.length > 0;
  const legalDone = ctx.settings.legal_confirmed;
  const mailOn = emailConfigured(ctx.env);
  const mail = ctx.url.searchParams.get('mail');
  const mailNotice = mail === 'sent' ? notice('ok', t('m.email.sent'))
    : mail === 'notsent' ? notice('warn', html`${t('m.email.notSent')}${isDev(ctx.env) ? html` ${t('m.email.dev')}` : ''}`)
      : mail === 'limit' ? notice('warn', t('m.email.limit')) : '';
  const copyBtn = (id: string) => html`<button class="secondary small" type="button" data-copy="${id}">${t('m.copy')}</button>`;
  return htmlResponse(page(ctx, {
    title: t('m.home.title'), area: 'merchant',
    body: html`<h1>${ready ? t('m.home.readyTitle') : t('m.home.title')}</h1><p class="lead">${ready ? t('m.home.readyLead') : t('m.home.lead')}</p>
    ${extra?.error ? notice('err', extra.error) : ''}${extra?.saved ? notice('ok', '✓') : ''}
    ${extra?.token ? html`<section class="card"><h2>${t('m.tokens.created')}</h2><div class="token" id="new-token">${extra.token}</div>
      <div class="actions">${copyBtn('new-token')}</div>
      <h3>Claude Code</h3><pre id="snip-key-cli">${keyCli}</pre>${copyBtn('snip-key-cli')}
      <h3>MCP config (JSON)</h3><pre id="snip-json">${jsonSnippet}</pre>${copyBtn('snip-json')}</section>` : ''}
    <ol class="steps">
      <li class="step done"><div class="step-n" aria-hidden="true">✓</div><div class="step-body">
        <p class="step-label">${t('m.step', { n: 1 })}</p><h2>${t('m.step1.title')}</h2><p>${t('m.step1.body')} <a href="#business">${t('m.step1.edit')}</a></p></div></li>

      <li class="step ${active.length ? 'done' : 'current'}"><div class="step-n" aria-hidden="true">${active.length ? '✓' : '2'}</div><div class="step-body">
        <p class="step-label">${t('m.step', { n: 2 })}</p><h2>${t('m.step2.title')}</h2><p>${t('m.step2.what')}</p>
        <div class="options">
          <section class="option"><h3>${t('m.step2.claude.title')}</h3>
            <ol><li>${t('m.step2.claude.1')}</li>
              <li>${t('m.step2.claude.2')}<div class="copyrow"><code id="mcp-url">${mcpUrl}</code>${copyBtn('mcp-url')}</div></li>
              <li>${t('m.step2.claude.3')}</li></ol>
            ${isLocalHttp(ctx.url) ? html`<p class="muted">${t('m.step2.claude.local')}</p>` : ''}</section>
          <section class="option"><h3>${t('m.step2.code.title')}</h3><p>${t('m.step2.code.1')}</p>
            <pre id="snip-cli">${connectCli}</pre>${copyBtn('snip-cli')}<p class="muted">${t('m.step2.code.2')}</p></section>
        </div>
        ${isOwner ? html`<details class="more"><summary>${t('m.step2.other.title')}</summary><p>${t('m.step2.other.body')}</p>
          <form method="post" action="/merchant/tokens">${csrfField(ctx)}
          <div class="row"><div><label for="tname">${t('m.tokens.name')}</label><input id="tname" name="name" type="text" required maxlength="60" placeholder="Claude"></div>
          <div><label for="tscope">${t('m.tokens.scope')}</label><select id="tscope" name="scope">${SCOPES.map((s) => html`<option value="${s}" ${s === 'configure' ? html`selected` : ''}>${t(`scope.${s}` as never)}</option>`)}</select></div></div>
          <div class="actions"><button type="submit">${t('m.tokens.create')}</button></div></form></details>` : ''}
        <h3>${t('m.step2.connected')}</h3>
        ${tokens.length ? tokens.map((tk) => html`<div class="item"><div><strong>${tk.name}</strong> <span class="badge ${tk.revoked_at ? 'err' : 'ok'}">${tk.revoked_at ? 'revoked' : tk.scope}</span><br>
          <small>${t('m.tokens.lastUsed')}: ${tk.last_used_at ? formatDate(tk.last_used_at, ctx.lang) : t('m.tokens.never')}</small></div>
          ${!tk.revoked_at && isOwner ? html`<form method="post" action="/merchant/tokens/${tk.id}/revoke">${csrfField(ctx)}<button class="danger small" data-confirm="${t('m.tokens.revoke')}?">${t('m.tokens.revoke')}</button></form>` : ''}</div>`)
          : html`<p class="muted">${t('m.tokens.none')}</p>`}
      </div></li>

      <li class="step ${complete ? 'done' : active.length ? 'current' : ''}"><div class="step-n" aria-hidden="true">${complete ? '✓' : '3'}</div><div class="step-body">
        <p class="step-label">${t('m.step', { n: 3 })}</p><h2>${t('m.step3.title')}</h2><p>${t('m.step3.body')}</p>
        <ul class="checklist" data-poll="/merchant/progress">${list}</ul>
        <details class="more" ${!complete && active.length ? html`open` : ''}><summary>${t('m.step3.promptTitle')}</summary>
          <pre id="agent-prompt">${t('m.step3.prompt')}</pre>${copyBtn('agent-prompt')}</details>
        <details class="more" ${!shopConnected ? html`open` : ''}><summary>${t('m.step3.key.title')}</summary>
          <ol><li>${t('m.step3.key.1')}</li><li>${t('m.step3.key.2')}</li><li>${t('m.step3.key.3')}</li></ol><p class="muted">${t('m.step3.key.why')}</p></details>
        <p class="any-shop">${icon('store')} <span>${t('m.step3.other')}</span></p>
      </div></li>

      <li class="step ${legalDone && mailOn ? 'done' : complete ? 'current' : ''}"><div class="step-n" aria-hidden="true">${legalDone && mailOn ? '✓' : '4'}</div><div class="step-body">
        <p class="step-label">${t('m.step', { n: 4 })}</p><h2>${t('m.step4.title')}</h2><p>${t('m.step4.body')}</p>
        <div class="options">
          <section class="option" id="legal"><h3>${t('m.legal.title')} <span class="badge ${legalDone ? 'ok' : 'warn'}">${legalDone ? t('m.done') : t('m.email.off')}</span></h3>
            <p>${t('m.legal.body')}</p>
            <p class="muted">${t('m.legal.preview')} <a href="/legal/terms" target="_blank">${t('legal.terms')}</a> · <a href="/legal/privacy" target="_blank">${t('legal.privacy')}</a> · <a href="/legal/imprint" target="_blank">${t('legal.imprint')}</a>
              · <em>${ctx.settings.legal_terms_url || ctx.settings.legal_privacy_url ? t('m.legal.usingOwn') : t('m.legal.usingTemplate')}</em></p>
            ${isOwner ? html`<form method="post" action="/merchant/legal">${csrfField(ctx)}
              <label for="terms_url">${t('m.legal.termsUrl')}</label><input id="terms_url" name="terms_url" type="url" inputmode="url" placeholder="https://" value="${ctx.settings.legal_terms_url ?? ''}">
              <label for="privacy_url">${t('m.legal.privacyUrl')}</label><input id="privacy_url" name="privacy_url" type="url" inputmode="url" placeholder="https://" value="${ctx.settings.legal_privacy_url ?? ''}">
              <label class="check"><input type="checkbox" name="confirm" value="1" ${legalDone ? html`checked` : ''}> <span>${t('m.legal.confirm')}</span></label>
              <div class="actions"><button type="submit" class="small">${t('m.legal.save')}</button></div></form>` : ''}
          </section>
          <section class="option" id="email"><h3>${t('m.email.title')} <span class="badge ${mailOn ? 'ok' : 'warn'}">${mailOn ? t('m.done') : t('m.email.off')}</span></h3>
            ${mailNotice}
            <p>${mailOn ? t('m.email.on', { from: ctx.env.MAIL_FROM ?? '' }) : t('m.email.body')}</p>
            ${mailOn ? '' : html`<ol><li>${t('m.email.1')}</li><li>${t('m.email.2')}</li><li>${t('m.email.3')}</li><li>${t('m.email.4')}</li></ol>`}
            <form method="post" action="/merchant/email-test">${csrfField(ctx)}<button type="submit" class="secondary small">${t('m.email.test', { email: shop.email })}</button></form>
          </section>
        </div>
      </div></li>
    </ol>

    <div class="split halves">
      <section class="card"><h2>${t('m.after.title')}</h2><p>${t('m.after.body')}</p><a class="btn secondary" href="/merchant/approvals">${t('m.approvals.title')}</a></section>
      <section class="card molten"><h2>${t('m.molten.title')}</h2><p>${t('m.molten.body')}</p>
        <p class="muted">${t('m.molten.today')}</p>
        <a class="btn secondary" href="https://moltenrock.com" rel="noopener">${t('m.molten.cta')}</a></section>
    </div>

    <details class="card fold" id="business" ${extra?.error || extra?.saved ? html`open` : ''}><summary><h2>${t('m.business.title')}</h2></summary><p class="muted">${t('m.business.lead')}</p>
      ${isOwner ? html`<form method="post" action="/merchant/business">${csrfField(ctx)}
        <label for="legal_name">${t('m.field.legalName')}</label><input id="legal_name" name="legal_name" type="text" required value="${shop.legal_name}">
        <div class="row r31"><div><label for="street">${t('field.street')}</label><input id="street" name="street" type="text" required value="${shop.street}"></div>
          <div><label for="house_no">${t('field.houseNo')}</label><input id="house_no" name="house_no" type="text" value="${shop.house_no}"></div></div>
        <div class="row r13"><div><label for="postcode">${t('field.postcode')}</label><input id="postcode" name="postcode" type="text" required value="${shop.postcode}"></div>
          <div><label for="city">${t('field.city')}</label><input id="city" name="city" type="text" required value="${shop.city}"></div></div>
        <label for="email">${t('m.field.email')}</label><input id="email" name="email" type="email" required value="${shop.email}">
        <label for="uid">${t('field.uid')}</label><input id="uid" name="uid" type="text" value="${shop.uid ?? ''}">
        <label class="check"><input type="checkbox" name="vat_registered" value="1" ${shop.vat_registered ? html`checked` : ''}> ${t('m.field.vatRegistered')}</label>
        <label for="iban">${t('m.field.iban')}</label><input id="iban" name="iban" type="text" required value="${shop.iban ? formatIban(shop.iban) : ''}">
        <div class="actions"><button type="submit">${t('m.business.save')}</button></div></form>`
      : html`<dl class="kv"><dt>IBAN</dt><dd>${maskIban(shop.iban)}</dd></dl>`}
    </details>
    <details class="card fold"><summary><h2>${t('m.dev.title')}</h2></summary>
      <dl class="kv"><dt>MCP</dt><dd><code>${mcpUrl}</code></dd><dt>OAuth</dt><dd><a href="/.well-known/oauth-authorization-server">/.well-known/oauth-authorization-server</a></dd>
        <dt>llms.txt</dt><dd><a href="/llms.txt">${ctx.baseUrl}/llms.txt</a></dd><dt>OpenAPI</dt><dd><a href="/api/v1/openapi.json">/api/v1/openapi.json</a></dd></dl>
    </details>`,
  }));
}

export async function tokenCreate(ctx: Ctx): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  try {
    const { token } = await createAgentToken(ctx.env.DB, actor, f.name ?? '', (f.scope ?? 'read') as AgentScope);
    return home(ctx, { token });
  } catch (e) { if (e instanceof AppError) return home(ctx, { error: e.message }); throw e; }
}

export async function tokenRevoke(ctx: Ctx, id: string): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  assertCsrf(ctx.req, ctx.viewer!.session, await readForm(ctx.req));
  await revokeAgentToken(ctx.env.DB, actor, Number(id));
  return redirect('/merchant/setup');
}

export async function businessSave(ctx: Ctx): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  try { await updateShopIdentity(ctx.env.DB, actor, { ...(f as unknown as ShopIdentityInput), vat_registered: f.vat_registered === '1' }); }
  catch (e) { if (e instanceof AppError) return home(ctx, { error: e.message }); throw e; }
  return redirect('/merchant/setup?saved=1');
}

// ---- Approvals ------------------------------------------------------------------------------

export async function approvals(ctx: Ctx, created?: { company: string; link: string }): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  const { t } = ctx;
  const [pending, held, proposals, tiers, active, prices] = await Promise.all([
    listPartners(ctx.env.DB, 'pending'), listOrders(ctx.env.DB, { state: 'awaiting_approval' }), listProposals(ctx.env.DB), listTiers(ctx.env.DB), listPartners(ctx.env.DB, 'approved'),
    listPricesToConfirm(ctx.env.DB, ctx.lang),
  ]);
  const vatLabel = (incl: number | null) => (incl ? t('p.incl') : t('p.excl'));
  const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  const money = (r: number) => formatMoney(r, ctx.lang);
  const tierSelect = (suggested?: string | null) => html`<select name="tier_id" aria-label="${t('m.tier')}">${tiers.map((ti) => html`<option value="${ti.id}" ${ti.is_default && !suggested ? html`selected` : ''}>${ti.name} (−${bpToPercent(ti.discount_bp)}%)</option>`)}</select>`;
  const empty = html`<p class="muted">${t('m.approvals.none')}</p>`;
  return htmlResponse(page(ctx, {
    title: t('m.approvals.title'), area: 'merchant',
    body: html`<div class="dash"><header class="dash-head"><div><p class="eyebrow">${t('m.nav.approvals')}</p><h1>${t('m.approvals.title')}</h1><p class="lead">${t('m.approvals.lead')}</p></div></header>
    ${prices.length ? html`<section class="panel prices" id="prices">
      <header class="panel-head"><span class="x-ic">${icon('tag')}</span><div><h2>${t('p.title')} <span class="count-pill">${prices.length}</span></h2><p>${t('p.lead')}</p></div>
        <form method="post" action="/merchant/prices">${csrfField(ctx)}<input type="hidden" name="all" value="1"><button name="decision" value="confirm">${icon('check')} ${t('p.confirmAll', { n: prices.length })}</button></form></header>
      <div class="price-table" role="table">${prices.slice(0, 200).map((p) => {
        const changed = p.proposed_price_rappen !== null;
        const newPrice = changed ? (p.proposed_price_rappen as number) : p.price_rappen;
        const pct = changed && p.price_rappen ? Math.round(((newPrice - p.price_rappen) / p.price_rappen) * 100) : 0;
        return html`<div class="pr-row${changed ? ' changed' : ''}" role="row">
          <span class="pr-name"><strong>${p.name ?? (p.sku || p.source_id)}</strong><small>${p.sku ? `${p.sku} · ` : ''}${p.source_url ? html`<a href="${p.source_url}" target="_blank" rel="noopener">${host(p.source_url)} ↗</a>` : t('p.noSource')}</small></span>
          <span class="pr-state"><span class="pill ${changed ? 'awaiting_approval' : 'cancel_window'}">${changed ? t('p.changed') : t('p.new')}</span></span>
          <span class="pr-price"><span><b>${money(newPrice)}</b> <small>${vatLabel(changed ? p.proposed_prices_include_tax : p.prices_include_tax)}</small></span>${changed ? html`<span class="pr-was"><s>${money(p.price_rappen)}</s>${pct ? html` <span class="delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%</span>` : ''}</span>` : ''}</span>
          <form class="pr-act" method="post" action="/merchant/prices">${csrfField(ctx)}<input type="hidden" name="id" value="${p.id}">
            <button name="decision" value="confirm" class="small">${t('m.confirm')}</button><button name="decision" value="decline" class="secondary small">${t('m.reject')}</button></form>
        </div>`;
      })}</div></section>` : ''}
    ${created ? html`<section class="panel">${notice('ok', t('m.partners.linkCreated', { company: created.company }))}<div class="token" id="partner-link">${created.link}</div>
      <div class="actions"><button class="secondary small" type="button" data-copy="partner-link">Copy</button></div></section>` : ''}
    <section class="panel"><h2>${t('m.approvals.proposals')}</h2>${proposals.length ? proposals.map((p) => {
      const payload = JSON.parse(p.payload) as Record<string, unknown>;
      return html`<div class="item"><div><strong>${p.kind.replace('_', ' ')}</strong> #${p.target_id} ${payload.decision ? html`→ <span class="badge warn">${String(payload.decision)}</span>` : ''}<br>
        <span>${p.reason}</span><br><small>${t('m.proposedBy', { who: p.proposed_by })} · ${formatDate(p.created_at, ctx.lang)}</small></div>
        <form method="post" action="/merchant/proposals/${p.id}/decide">${csrfField(ctx)}<button name="decision" value="confirm" class="small">${t('m.confirm')}</button><button name="decision" value="reject" class="secondary small">${t('m.reject')}</button></form></div>`;
    }) : empty}</section>
    <section class="panel"><h2>${t('m.approvals.partners')}</h2>${pending.length ? pending.map((p) => html`<div class="item">
      <div><strong>${p.company}</strong> · ${p.contact_name} · ${p.email}<br><small>${p.street} ${p.house_no}, ${p.postcode} ${p.city} · ${p.uid ?? '—'} · ${t(`business.${p.business_type}` as never)}${p.suggested_template ? ` · template: ${p.suggested_template}` : ''}</small></div>
      <form method="post" action="/merchant/partners/${p.id}/decide">${csrfField(ctx)}${tierSelect(p.suggested_template)}<button name="decision" value="approve" class="small">${t('m.approve')}</button><button name="decision" value="reject" class="secondary small">${t('m.reject')}</button></form></div>`) : empty}</section>
    <section class="panel"><h2>${t('m.approvals.baskets')}</h2>${held.length ? held.map((o) => html`<div class="item">
      <div><strong>${o.ref}</strong> · ${o.company} · <strong>${money(o.total_rappen)}</strong> <small>(${money(o.subtotal_net_rappen)} net)</small><br><small>${formatDate(o.created_at, ctx.lang)}${o.po_number ? ` · PO ${o.po_number}` : ''}</small></div>
      <form method="post" action="/merchant/orders/${o.id}/decide">${csrfField(ctx)}<button name="decision" value="approve" class="small">${t('m.approve')}</button><button name="decision" value="reject" class="secondary small">${t('m.reject')}</button></form></div>`) : empty}</section>
    <section class="panel"><h2>${t('m.partners.title')}</h2>${active.length ? active.map((p) => html`<div class="item">
      <div><strong>${p.company}</strong> · ${p.contact_name} · ${p.email}<br><small>${p.tier_name ?? ''} · ${p.city}</small></div>
      <form method="post" action="/merchant/partners/${p.id}/link">${csrfField(ctx)}<button class="secondary small">${t('m.partners.link')}</button></form></div>`) : html`<p class="muted">${t('m.partners.none')}</p>`}</section></div>`,
  }));
}

async function decide(ctx: Ctx, fn: (decision: string, f: Record<string, string>) => Promise<unknown>): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  await fn(f.decision ?? '', f);
  return redirect('/merchant/approvals');
}

export const partnerDecide = (ctx: Ctx, id: string) => decide(ctx, (d, f) => {
  if (!['approve', 'reject'].includes(d)) throw new AppError('INVALID', 'Invalid decision');
  return decidePartner(ctx.env, ctx.viewer!.actor, Number(id), d as 'approve', f.tier_id ? Number(f.tier_id) : null, ctx.baseUrl);
});
export const orderDecide = (ctx: Ctx, id: string) => decide(ctx, (d) => {
  if (!['approve', 'reject'].includes(d)) throw new AppError('INVALID', 'Invalid decision');
  return decideHeldOrder(ctx.env, ctx.viewer!.actor, Number(id), d as 'approve', '', ctx.baseUrl);
});
export const proposalDecide = (ctx: Ctx, id: string) => decide(ctx, (d) => {
  if (!['confirm', 'reject'].includes(d)) throw new AppError('INVALID', 'Invalid decision');
  return decideProposal(ctx.env, ctx.viewer!.actor, Number(id), d as 'confirm', ctx.baseUrl);
});

/**
 * Human-only: create a fresh 7-day sign-in link for a partner, to forward by email or message.
 * This is how partners get in when no email provider is configured. Agents never see these links.
 */
export async function partnerLink(ctx: Ctx, id: string): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  assertCsrf(ctx.req, ctx.viewer!.session, await readForm(ctx.req));
  const p = await getPartner(ctx.env.DB, Number(id));
  if (!p || p.status !== 'approved') throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  const link = `${ctx.baseUrl}/auth/verify?t=${await createMagicLink(ctx.env, p.email, INVITE_LINK_TTL)}`;
  await run(ctx.env.DB, "INSERT INTO audit_log (at, actor_type, actor_label, action, target, detail) VALUES (?, 'user', ?, 'partner.signin_link', ?, '{}')", now(), `user:${actor.label}`, `partner:${p.id}`);
  return approvals(ctx, { company: p.company, link });
}

/** HUMAN-ONLY: confirm or decline prices the agent found (one product, or all waiting). */
export async function pricesDecide(ctx: Ctx): Promise<Response> {
  const actor = requireOwnerOrStaff(ctx);
  if (actor instanceof Response) return actor;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  const decision = f.decision === 'decline' ? 'decline' : f.decision === 'confirm' ? 'confirm' : null;
  if (!decision) throw new AppError('INVALID', 'Invalid decision');
  await decidePrices(ctx.env.DB, actor, f.all === '1' ? 'all' : [Number(f.id)].filter((n) => Number.isInteger(n) && n > 0), decision);
  return redirect('/merchant/approvals#prices');
}
