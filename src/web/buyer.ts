// Buyer storefront: landing, apply, sign-in, catalogue, cart/checkout, orders, invoice download.

import { LANGS, t as tr } from '../i18n';
import { AppError, htmlResponse, readForm, redirect, safeNext, withHeaders, PRIVATE_HEADERS } from '../lib/http';
import { html, type Html } from '../lib/html';
import { bpToPercent, formatDate, formatMoney, isoDate } from '../money/format';
import { unitNetRappen, vatRateFor } from '../money/pricing';
import { assertCsrf, assertSameOrigin, clearSessionCookie, consumeMagicLink, createMagicLink, createSession, destroySession, lookupLogin, rateLimit } from '../domain/auth';
import { cartItems, partnerTier, priceItems, setCartQty, vatRates } from '../domain/cart';
import { listProducts, resolveText } from '../domain/catalog';
import { emailConfigured, sendEmail } from '../domain/db';
import { isDev } from '../lib/env';
import { displayNumber, invoiceDocument, invoicePdf, getInvoice, listInvoices } from '../domain/invoices';
import { renderInvoiceHtml } from '../invoice/html';
import { cancelOrder, getOrderByRef, listOrders, orderLines, placeOrder, reorder } from '../domain/orders';
import { applyForAccount, BUSINESS_TYPES, getPartner, type Partner } from '../domain/partners';
import type { Ctx } from './context';
import { acceptLabel } from './legal';
import { csrfField, messagePage, notice, page } from './layout';

const money = (ctx: Ctx, r: number) => formatMoney(r, ctx.lang, ctx.shop?.currency ?? 'CHF');

// ---- Landing --------------------------------------------------------------------------------

export async function landing(ctx: Ctx): Promise<Response> {
  if (!ctx.shop) return redirect('/merchant/signup');
  if (ctx.viewer?.actor.type === 'user') return redirect('/merchant');
  if (ctx.viewer?.partner?.status === 'approved') return redirect('/catalog');
  const { t } = ctx;
  return htmlResponse(page(ctx, {
    title: t('app.tradePortal'), area: 'public',
    body: html`<section class="hero">
      <span class="badge">B2B</span>
      <h1>${t('landing.title', { shop: ctx.shop.legal_name })}</h1>
      <p class="lead">${t('landing.lead')}</p>
      <div class="actions"><a class="btn" href="/apply">${t('nav.apply')}</a><a class="btn secondary" href="/login">${t('nav.login')}</a></div>
      <p class="muted">${t('landing.pricesHidden')}</p>
    </section>`,
  }));
}

// ---- Apply ----------------------------------------------------------------------------------

function applyForm(ctx: Ctx, values: Record<string, string> = {}, error?: string): Html {
  const { t } = ctx;
  const v = (k: string) => values[k] ?? '';
  const langSel = values.language ?? ctx.lang;
  return page(ctx, {
    title: t('apply.title'), area: 'public', narrow: true,
    body: html`<section class="card">
      <h1>${t('apply.title')}</h1>
      <p>${t('apply.lead')}</p>
      ${error ? notice('err', error) : ''}
      <form method="post" action="/apply">
        <label for="company">${t('field.company')}</label><input id="company" name="company" type="text" required maxlength="120" value="${v('company')}" autocomplete="organization">
        <label for="contact_name">${t('field.contact')}</label><input id="contact_name" name="contact_name" type="text" required maxlength="120" value="${v('contact_name')}" autocomplete="name">
        <div class="row">
          <div><label for="email">${t('field.email')}</label><input id="email" name="email" type="email" required value="${v('email')}" autocomplete="email"></div>
          <div><label for="phone">${t('field.phone')}</label><input id="phone" name="phone" type="tel" value="${v('phone')}" autocomplete="tel"></div>
        </div>
        <div class="row r31">
          <div><label for="street">${t('field.street')}</label><input id="street" name="street" type="text" required value="${v('street')}" autocomplete="address-line1"></div>
          <div><label for="house_no">${t('field.houseNo')}</label><input id="house_no" name="house_no" type="text" value="${v('house_no')}"></div>
        </div>
        <div class="row r13">
          <div><label for="postcode">${t('field.postcode')}</label><input id="postcode" name="postcode" type="text" required pattern="[1-9][0-9]{3}" inputmode="numeric" value="${v('postcode')}" autocomplete="postal-code"></div>
          <div><label for="city">${t('field.city')}</label><input id="city" name="city" type="text" required value="${v('city')}" autocomplete="address-level2"></div>
        </div>
        <label for="uid">${t('field.uid')}</label><input id="uid" name="uid" type="text" value="${v('uid')}" placeholder="CHE-123.456.789">
        <div class="row">
          <div><label for="language">${t('field.language')}</label><select id="language" name="language">${LANGS.map((l) => html`<option value="${l}" ${l === langSel ? html`selected` : ''}>${tr(l, 'lang.name')}</option>`)}</select></div>
          <div><label for="business_type">${t('field.businessType')}</label><select id="business_type" name="business_type">${BUSINESS_TYPES.map((b) => html`<option value="${b}" ${b === values.business_type ? html`selected` : ''}>${t(`business.${b}` as never)}</option>`)}</select></div>
        </div>
        <label class="check"><input type="checkbox" name="terms" value="1" required> <span>${acceptLabel(ctx)}</span></label>
        <div class="actions"><button type="submit">${t('apply.submit')}</button></div>
      </form>
    </section>`,
  });
}

export const applyGet = async (ctx: Ctx) => (ctx.shop ? htmlResponse(applyForm(ctx)) : redirect('/merchant/signup'));

export async function applyPost(ctx: Ctx): Promise<Response> {
  assertSameOrigin(ctx.req);
  const f = await readForm(ctx.req);
  const ip = ctx.req.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await rateLimit(ctx.env.DB, `apply:${ip}`, 10, 3600_000))) return htmlResponse(applyForm(ctx, f, ctx.t('err.rateLimited')), { status: 429 });
  try {
    await applyForAccount(ctx.env, f as never, f.terms === '1');
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    const key = ({ INVALID_UID: 'err.uid', INVALID_POSTCODE: 'err.postcode', INVALID_EMAIL: 'err.email', TERMS: 'err.terms', REQUIRED: 'err.required' } as const)[e.code as 'REQUIRED'];
    return htmlResponse(applyForm(ctx, f, key ? ctx.t(key) : e.message), { status: 400 });
  }
  const m = messagePage(ctx, ctx.t('apply.done.title'), ctx.t('apply.done.body'));
  return htmlResponse(m.body);
}

// ---- Sign-in (magic links) ------------------------------------------------------------------

const noEmail = (ctx: Ctx) => !emailConfigured(ctx.env) && !isDev(ctx.env);
const noEmailText = (ctx: Ctx) => ctx.t('login.noEmail', { setup: ctx.t('m.nav.home'), button: ctx.t('m.signin.otherBtn') });

export function loginGet(ctx: Ctx, error?: string): Response {
  const { t } = ctx;
  const next = safeNext(ctx.url.searchParams.get('next'), '');
  return htmlResponse(page(ctx, {
    title: t('login.title'), area: 'public', narrow: true,
    body: html`<section class="card"><h1>${t('login.title')}</h1><p>${t('login.lead')}</p>${error ? notice('err', error) : ''}${noEmail(ctx) ? notice('info', noEmailText(ctx)) : ''}
      <form method="post" action="/login${next ? `?next=${encodeURIComponent(next)}` : ''}"><label for="email">${t('field.email')}</label><input id="email" name="email" type="email" required autocomplete="email">
      <div class="actions"><button type="submit">${t('login.submit')}</button></div></form></section>`,
  }));
}

export async function loginPost(ctx: Ctx): Promise<Response> {
  assertSameOrigin(ctx.req);
  const f = await readForm(ctx.req);
  const email = (f.email ?? '').trim().toLowerCase();
  const ip = ctx.req.headers.get('CF-Connecting-IP') ?? 'local';
  const allowed = (await rateLimit(ctx.env.DB, `login-ip:${ip}`, 30, 900_000)) && (await rateLimit(ctx.env.DB, `login-email:${email}`, 5, 900_000));
  if (!allowed) return loginGet(ctx, ctx.t('err.rateLimited'));
  // Always answer the same way, so the form can't be used to discover who has an account.
  if (email && (await lookupLogin(ctx.env.DB, email))) {
    // Carry ?next= (e.g. back to an agent-connect consent page) through the emailed link.
    const next = safeNext(ctx.url.searchParams.get('next'), '');
    const link = `${ctx.baseUrl}/auth/verify?t=${await createMagicLink(ctx.env, email)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    const shopName = ctx.shop?.legal_name ?? 'MoltenRock Trade';
    await sendEmail(ctx.env, email, ctx.t('email.login.subject', { shop: shopName }), ctx.t('email.login.body', { link }));
  }
  // Without an email provider no link arrives: say so instead of "check your inbox".
  const m = noEmail(ctx) ? messagePage(ctx, ctx.t('login.noEmail.title'), noEmailText(ctx)) : messagePage(ctx, ctx.t('login.sent.title'), ctx.t('login.sent.body'));
  return htmlResponse(m.body);
}

/** GET only shows a confirm button — email link scanners can't burn the single-use link. */
export function verifyGet(ctx: Ctx): Response {
  const { t } = ctx;
  const token = ctx.url.searchParams.get('t') ?? '';
  const next = safeNext(ctx.url.searchParams.get('next'), '');
  return htmlResponse(page(ctx, {
    title: t('verify.title'), area: 'public', narrow: true,
    body: html`<section class="card"><h1>${t('verify.title')}</h1><p>${t('verify.body')}</p>
      <form method="post" action="/auth/verify${next ? `?next=${encodeURIComponent(next)}` : ''}"><input type="hidden" name="t" value="${token}"><div class="actions"><button type="submit">${t('verify.submit')}</button></div></form></section>`,
  }));
}

export async function verifyPost(ctx: Ctx): Promise<Response> {
  assertSameOrigin(ctx.req);
  const f = await readForm(ctx.req);
  const email = await consumeMagicLink(ctx.env, f.t ?? '');
  const who = email ? await lookupLogin(ctx.env.DB, email) : null;
  if (!who) return loginGet(ctx, ctx.t('verify.invalid'));
  if (ctx.viewer) await destroySession(ctx.env, ctx.viewer.session); // rotate: never reuse a prior session
  const { cookie } = await createSession(ctx.env, ctx.req, who.type, who.id);
  return redirect(safeNext(ctx.url.searchParams.get('next'), who.type === 'user' ? '/merchant' : '/catalog'), { 'Set-Cookie': cookie });
}

export async function logout(ctx: Ctx): Promise<Response> {
  if (ctx.viewer) {
    const f = await readForm(ctx.req);
    assertCsrf(ctx.req, ctx.viewer.session, f);
    await destroySession(ctx.env, ctx.viewer.session);
  }
  return redirect('/', { 'Set-Cookie': clearSessionCookie(ctx.req) });
}

// ---- Partner guard ---------------------------------------------------------------------------

async function requirePartner(ctx: Ctx): Promise<{ partner: Partner; actor: { type: 'partner'; id: number; partnerId: number; label: string } } | Response> {
  if (!ctx.shop) return redirect('/merchant/signup');
  const v = ctx.viewer;
  if (!v) return redirect(`/login`);
  if (v.actor.type !== 'partner' || !v.partner) return redirect('/merchant');
  if (v.partner.status !== 'approved') {
    const pending = v.partner.status === 'pending';
    const m = messagePage(ctx, ctx.t(pending ? 'blocked.pending.title' : 'blocked.closed.title'), ctx.t(pending ? 'blocked.pending.body' : 'blocked.closed.body'), 'buyer', 403);
    return htmlResponse(m.body, { status: m.status });
  }
  const partner = await getPartner(ctx.env.DB, v.partner.id);
  if (!partner) return redirect('/login');
  // Invited customers never saw the application form: they accept the terms once, before ordering.
  if (!partner.terms_accepted_at) return redirect(`/legal/accept?next=${encodeURIComponent(ctx.url.pathname)}`);
  return { partner, actor: v.actor };
}

const priceCtx = (ctx: Ctx, partner: Partner) => ({ shop: ctx.shop!, settings: ctx.settings, partner, lang: ctx.lang });

// ---- Catalogue -------------------------------------------------------------------------------

export async function catalog(ctx: Ctx): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  const { t } = ctx;
  const tier = await partnerTier(ctx.env.DB, g.partner);
  const rates = await vatRates(ctx.env.DB);
  const { items } = await listProducts(ctx.env.DB, { filter: 'orderable', limit: 500, respectStock: ctx.settings.respect_stock });
  const cart = await priceItems(ctx.env.DB, priceCtx(ctx, g.partner), await cartItems(ctx.env.DB, g.partner.id));
  const inCart = new Map(cart.lines.map((l) => [l.product_id, l.qty]));
  const today = isoDate(Date.now());
  const added = ctx.url.searchParams.get('added');
  const err = ctx.url.searchParams.get('error');
  const cards = items.map((p) => {
    const text = resolveText(p, ctx.lang, ctx.settings.language_fallback);
    const unit = unitNetRappen({ priceRappen: p.price_rappen, pricesIncludeTax: !!p.prices_include_tax, vatRateBp: vatRateFor(p.vat_code, today, rates), discountBp: tier.discount_bp });
    const step = p.carton_multiple ?? 1;
    const min = Math.max(p.min_qty ?? 1, step);
    return html`<article class="card product">
      <div class="img">${p.image_url ? html`<img src="${p.image_url}" alt="" loading="lazy">` : ''}</div>
      <div><h3 lang="${text.lang}">${text.name}</h3>${text.short_desc ? html`<p class="muted" lang="${text.lang}">${text.short_desc.slice(0, 160)}</p>` : ''}</div>
      <div><span class="price">${money(ctx, unit)}</span> <small>${t('catalog.unitPrice')}</small>
        ${p.carton_multiple ? html`<div class="hint">${t('catalog.carton', { n: p.carton_multiple })}</div>` : ''}
        ${p.min_qty ? html`<div class="hint">${t('catalog.minQty', { n: p.min_qty })}</div>` : ''}
        ${p.stock_status === 'outofstock' ? html`<div class="hint">${t('catalog.outOfStock')}</div>` : ''}
        ${inCart.has(p.id) ? html`<span class="badge ok">${t('catalog.added')}: ${inCart.get(p.id)}</span>` : ''}</div>
      <form method="post" action="/cart/add">${csrfField(ctx)}<input type="hidden" name="product_id" value="${p.id}">
        <input class="qty" type="number" name="qty" min="${min}" max="999" step="${step}" value="${min}" aria-label="${t('catalog.qty')}">
        <button type="submit" class="small">${t('catalog.add')}</button></form>
    </article>`;
  });
  return htmlResponse(page(ctx, {
    title: t('catalog.title'),
    body: html`<h1>${t('catalog.title')}</h1>
      <p>${t('catalog.yourTier', { tier: tier.name, pct: bpToPercent(tier.discount_bp) })} · <span class="muted">${t('catalog.netNote')}</span></p>
      ${added ? notice('ok', t('catalog.added')) : ''}${err ? notice('err', err) : ''}
      ${cart.lines.length ? cartProgress(ctx, cart.totals.subtotalNetRappen, cart.min_order_rappen) : ''}
      ${items.length ? html`<div class="grid">${cards}</div>` : html`<p>${t('catalog.empty')}</p>`}`,
  }));
}

function cartProgress(ctx: Ctx, subtotal: number, min: number): Html {
  const pct = min ? Math.min(100, Math.floor((subtotal / min) * 10) * 10) : 100;
  const missing = Math.max(0, min - subtotal);
  return html`<div class="card"><div class="item"><strong><a href="/cart">${ctx.t('nav.cart')}: ${money(ctx, subtotal)}</a></strong>
    ${missing ? html`<span class="muted">${ctx.t('cart.minMissing', { amount: money(ctx, missing), min: money(ctx, min) })}</span>` : html`<a class="btn small" href="/cart">${ctx.t('cart.checkout')}</a>`}</div>
    <div class="progress"><span class="p${pct}"></span></div></div>`;
}

export async function cartAdd(ctx: Ctx): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  const productId = Number(f.product_id);
  const qty = Number(f.qty);
  const current = (await cartItems(ctx.env.DB, g.partner.id)).find((i) => i.product_id === productId)?.qty ?? 0;
  try { await setCartQty(ctx.env.DB, g.partner.id, productId, Math.min(999, current + qty), ctx.settings); }
  catch (e) { if (e instanceof AppError) return redirect(`/catalog?error=${encodeURIComponent(e.message)}`); throw e; }
  return redirect(`/catalog?added=${productId}`);
}

export async function cartUpdate(ctx: Ctx): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  try {
    for (const [k, v] of Object.entries(f)) {
      const m = /^qty_(\d+)$/.exec(k);
      if (m) await setCartQty(ctx.env.DB, g.partner.id, Number(m[1]), f.remove === m[1] ? 0 : Number(v), ctx.settings);
    }
  } catch (e) { if (e instanceof AppError) return cartGet(ctx, e.message); throw e; }
  return redirect('/cart');
}

export async function cartGet(ctx: Ctx, error?: string): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  const { t } = ctx;
  const priced = await priceItems(ctx.env.DB, priceCtx(ctx, g.partner), await cartItems(ctx.env.DB, g.partner.id));
  const threshold = ctx.settings.approval_threshold_rappen;
  const terms = g.partner.prepayment ? t('checkout.prepayment') : t('checkout.terms', { days: g.partner.payment_terms_days ?? ctx.settings.payment_terms_days });
  if (!priced.lines.length) return htmlResponse(page(ctx, { title: t('cart.title'), body: html`<h1>${t('cart.title')}</h1>${error ? notice('err', error) : ''}<p>${t('cart.empty')}</p><a class="btn" href="/catalog">${t('nav.catalog')}</a>` }));
  return htmlResponse(page(ctx, {
    title: t('cart.title'),
    body: html`<h1>${t('cart.title')}</h1>${error ? notice('err', error) : ''}${!ctx.shop?.iban ? notice('warn', t('err.shopNotReady')) : ''}
    ${priced.problems.length ? notice('warn', priced.problems.map((p) => `#${p.product_id}: ${p.reason}`).join(' · ')) : ''}
    <div class="split">
      <form class="card" method="post" action="/cart/update">${csrfField(ctx)}
        <table><thead><tr><th>${t('cart.product')}</th><th class="num">${t('cart.qty')}</th><th class="num">${t('cart.unit')}</th><th class="num">${t('cart.line')}</th><th></th></tr></thead>
        <tbody>${priced.lines.map((l) => html`<tr><td>${l.name}<br><small>${l.sku}</small></td>
          <td class="num"><input class="qty" type="number" name="qty_${l.product_id}" min="1" max="999" step="${l.carton_multiple ?? 1}" value="${l.qty}"></td>
          <td class="num">${money(ctx, l.unit_net_rappen)}</td><td class="num">${money(ctx, l.line_net_rappen)}</td>
          <td><button class="link" name="remove" value="${l.product_id}">${t('cart.remove')}</button></td></tr>`)}</tbody>
        <tfoot><tr><td colspan="3">${t('cart.subtotal')}</td><td class="num">${money(ctx, priced.totals.subtotalNetRappen)}</td><td></td></tr>
          ${priced.totals.breakdown.map((b) => html`<tr><td colspan="3">${t('cart.vat', { rate: bpToPercent(b.rateBp) })}</td><td class="num">${money(ctx, b.vatRappen)}</td><td></td></tr>`)}
          <tr class="total"><td colspan="3">${priced.totals.breakdown.length ? t('cart.total') : t('cart.totalNoVat')}</td><td class="num">${money(ctx, priced.totals.totalRappen)}</td><td></td></tr></tfoot></table>
        <div class="actions"><button class="secondary" type="submit">${t('cart.update')}</button></div>
      </form>
      <form class="card" method="post" action="/checkout">${csrfField(ctx)}
        <h2>${t('checkout.title')}</h2>
        ${priced.missing_rappen ? notice('warn', t('cart.minMissing', { amount: money(ctx, priced.missing_rappen), min: money(ctx, priced.min_order_rappen) })) : ''}
        ${threshold !== null && !g.partner.trusted ? html`<p class="muted">${t('cart.approvalNote', { amount: money(ctx, threshold), shop: ctx.shop!.legal_name })}</p>` : ''}
        <label for="po_number">${t('checkout.po')}</label><input id="po_number" name="po_number" type="text" maxlength="35">
        <label>${t('checkout.shipMode')}</label>
        <label class="check"><input type="radio" name="ship_mode" value="delivery" checked> ${t('checkout.delivery')}<br><small>${g.partner.company}, ${g.partner.street} ${g.partner.house_no}, ${g.partner.postcode} ${g.partner.city}</small></label>
        <label class="check"><input type="radio" name="ship_mode" value="pickup"> ${t('checkout.pickup')}</label>
        <label for="note">${t('checkout.note')}</label><textarea id="note" name="note" rows="2" maxlength="500"></textarea>
        <p class="muted">${terms}</p>
        <div class="actions"><button type="submit" ${priced.missing_rappen || priced.problems.length ? html`disabled` : ''}>${t('checkout.place')}</button></div>
      </form>
    </div>`,
  }));
}

export async function checkoutPost(ctx: Ctx): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  try {
    const order = await placeOrder(ctx.env, g.actor, priceCtx(ctx, g.partner), f, ctx.baseUrl);
    return redirect(`/orders/${order.ref}?placed=1`);
  } catch (e) {
    if (e instanceof AppError) return cartGet(ctx, e.code === 'MIN_ORDER' ? ctx.t('err.minOrder') : e.code === 'SHOP_NOT_READY' ? ctx.t('err.shopNotReady') : e.message);
    throw e;
  }
}

// ---- Orders & invoices -----------------------------------------------------------------------

export async function ordersList(ctx: Ctx): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  const { t } = ctx;
  const orders = await listOrders(ctx.env.DB, { partnerId: g.partner.id });
  return htmlResponse(page(ctx, {
    title: t('orders.title'),
    body: html`<h1>${t('orders.title')}</h1>${orders.length ? html`<div class="card"><table>
      <thead><tr><th>${t('order.ref')}</th><th>${t('order.date')}</th><th>${t('order.status')}</th><th class="num">${t('order.total')}</th></tr></thead>
      <tbody>${orders.map((o) => html`<tr><td><a href="/orders/${o.ref}">${o.ref}</a></td><td>${formatDate(o.created_at, ctx.lang)}</td>
        <td><span class="badge ${o.state === 'confirmed' ? 'ok' : o.state === 'awaiting_approval' ? 'warn' : o.state === 'cancelled' || o.state === 'rejected' ? 'err' : ''}">${t(`state.${o.state}` as never)}</span></td>
        <td class="num">${money(ctx, o.total_rappen)}</td></tr>`)}</tbody></table></div>` : html`<p>${t('orders.empty')}</p>`}`,
  }));
}

export async function orderDetail(ctx: Ctx, ref: string): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  const { t } = ctx;
  const o = await getOrderByRef(ctx.env.DB, ref);
  if (!o || o.partner_id !== g.partner.id) throw new AppError('NOT_FOUND', t('err.notFound'), 404);
  const lines = await orderLines(ctx.env.DB, o.id);
  const invoices = await listInvoices(ctx.env.DB, { orderId: o.id });
  const snap = JSON.parse(o.pricing_snapshot) as { totals: { subtotalNetRappen: number; vatRappen: number; totalRappen: number; breakdown: { rateBp: number; vatRappen: number }[] } };
  const canCancel = o.state === 'awaiting_approval' || (o.state === 'cancel_window' && (o.confirm_after ?? 0) > Date.now());
  const placed = ctx.url.searchParams.get('placed');
  return htmlResponse(page(ctx, {
    title: `${t('order.ref')} ${o.ref}`,
    body: html`<h1>${t('order.ref')} ${o.ref}</h1>
      ${placed ? notice('ok', o.state === 'awaiting_approval' ? t('order.placed.held', { shop: ctx.shop!.legal_name }) : `${t('order.placed.title')}. ${t('order.placed.body', { minutes: ctx.settings.cancel_window_minutes })}`) : ''}
      <div class="split"><div class="card"><table>
        <thead><tr><th>${t('cart.product')}</th><th class="num">${t('cart.qty')}</th><th class="num">${t('cart.unit')}</th><th class="num">${t('cart.line')}</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td>${l.name}<br><small>${l.sku}</small></td><td class="num">${l.qty}</td><td class="num">${money(ctx, l.unit_net_rappen)}</td><td class="num">${money(ctx, l.line_net_rappen)}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="3">${t('cart.subtotal')}</td><td class="num">${money(ctx, snap.totals.subtotalNetRappen)}</td></tr>
        ${snap.totals.breakdown.map((b) => html`<tr><td colspan="3">${t('cart.vat', { rate: bpToPercent(b.rateBp) })}</td><td class="num">${money(ctx, b.vatRappen)}</td></tr>`)}
        <tr class="total"><td colspan="3">${t('order.total')}</td><td class="num">${money(ctx, o.total_rappen)}</td></tr></tfoot></table></div>
      <div class="card"><dl class="kv"><dt>${t('order.status')}</dt><dd><span class="badge">${t(`state.${o.state}` as never)}</span></dd>
        <dt>${t('order.date')}</dt><dd>${formatDate(o.created_at, ctx.lang)}</dd>${o.po_number ? html`<dt>${t('order.po')}</dt><dd>${o.po_number}</dd>` : ''}</dl>
        <div class="actions">
          ${invoices.filter((i) => i.kind === 'invoice').map((i) => html`<a class="btn" href="/invoices/${i.id}">${t('inv.view')} ${displayNumber(i)}</a> <a class="btn secondary" href="/invoices/${i.id}.pdf">PDF</a>`)}
          ${canCancel ? html`<form method="post" action="/orders/${o.ref}/cancel">${csrfField(ctx)}<button class="danger" data-confirm="${t('order.cancel')}?">${t('order.cancel')}</button></form>` : ''}
          <form method="post" action="/orders/${o.ref}/reorder">${csrfField(ctx)}<button class="secondary">${t('order.reorder')}</button></form>
        </div></div></div>`,
  }));
}

export async function orderCancel(ctx: Ctx, ref: string): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  assertCsrf(ctx.req, ctx.viewer!.session, await readForm(ctx.req));
  const o = await getOrderByRef(ctx.env.DB, ref);
  if (!o) throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  await cancelOrder(ctx.env, g.actor, o.id);
  return redirect(`/orders/${ref}`);
}

export async function orderReorder(ctx: Ctx, ref: string): Promise<Response> {
  const g = await requirePartner(ctx);
  if (g instanceof Response) return g;
  assertCsrf(ctx.req, ctx.viewer!.session, await readForm(ctx.req));
  const o = await getOrderByRef(ctx.env.DB, ref);
  if (!o) throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  await reorder(ctx.env.DB, g.partner.id, o.id, ctx.settings);
  return redirect('/cart');
}

/**
 * Invoice: /invoices/:id is the print-ready HTML QR-bill (works on Cloudflare's free plan);
 * /invoices/:id.pdf renders the PDF (~25–35 ms CPU: needs the Workers Paid plan to be reliable).
 * Only the partner who owns it, or the merchant's people. Never cached.
 */
export async function invoiceDownload(ctx: Ctx, idParam: string): Promise<Response> {
  const wantsPdf = idParam.endsWith('.pdf');
  const id = Number(idParam.replace(/\.pdf$/, ''));
  const inv = Number.isInteger(id) ? await getInvoice(ctx.env.DB, id) : null;
  const v = ctx.viewer;
  const allowed = inv && v && (v.actor.type === 'user' || (v.actor.type === 'partner' && v.partner?.status === 'approved' && v.partner.id === inv.partner_id));
  if (!inv || !allowed) throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  if (!wantsPdf) {
    const back = v?.actor.type === 'partner' ? `/orders` : '/status';
    return htmlResponse(renderInvoiceHtml(await invoiceDocument(ctx.env, inv), { pdfHref: `/invoices/${inv.id}.pdf`, backHref: back }));
  }
  const bytes = await invoicePdf(ctx.env, inv.id);
  return withHeaders(new Response(bytes, { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${inv.kind === 'credit_note' ? 'credit-note' : 'invoice'}-${displayNumber(inv)}.pdf"`, ...PRIVATE_HEADERS,
  } }));
}
