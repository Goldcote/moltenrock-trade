// Legal pages of the merchant's portal (/legal/terms, /legal/privacy, /legal/imprint), the one-time
// "accept the terms" step for invited trade customers, and the owner's Legal + Email setup actions.

import type { Ctx } from './context';
import { AppError, htmlResponse, readForm, redirect, safeNext } from '../lib/http';
import { html, type Html } from '../lib/html';
import { assertCsrf, rateLimit } from '../domain/auth';
import { audit, emailConfigured, now, run, sendEmail } from '../domain/db';
import { updateSettings, type Settings, type Shop } from '../domain/settings';
import { legalDoc, TEMPLATE_VERSION, type LegalKind, type LegalVars } from '../legal/templates';
import type { Env } from '../lib/env';
import { legalHref } from '../legal/links';
import { csrfField, notice, page } from './layout';
import { home } from './merchant';

export const termsVersion = (s: Settings) => s.legal_terms_url ?? TEMPLATE_VERSION;

export function legalVars(env: Env, shop: Shop, s: Settings): LegalVars {
  return {
    shop: shop.legal_name, street: `${shop.street} ${shop.house_no}`.trim(), postcode: shop.postcode, city: shop.city, email: shop.email,
    uid: shop.uid, vatRegistered: !!shop.vat_registered, paymentDays: s.payment_terms_days, minOrderRappen: s.min_order_rappen,
    cancelMinutes: s.cancel_window_minutes, approvalRappen: s.approval_threshold_rappen, emailProvider: emailConfigured(env) ? 'Resend' : null,
  };
}

const link = (ctx: Ctx, kind: LegalKind, label: string) => {
  const href = legalHref(ctx.settings, kind);
  return href.startsWith('https://') ? html`<a href="${href}" target="_blank" rel="noopener">${label}</a>` : html`<a href="${href}" target="_blank">${label}</a>`;
};

/** "I accept the {terms} and the {privacy}." with both placeholders turned into links. */
export function acceptLabel(ctx: Ctx): Html {
  const text = ctx.t('legal.acceptLabel');
  const parts = text.split(/(\{terms\}|\{privacy\})/);
  return html`${parts.map((p) => (p === '{terms}' ? link(ctx, 'terms', ctx.t('legal.termsLink')) : p === '{privacy}' ? link(ctx, 'privacy', ctx.t('legal.privacyLink')) : p))}`;
}

export async function legalPage(ctx: Ctx, kind: string): Promise<Response> {
  if (!ctx.shop) return redirect('/merchant/signup');
  if (kind !== 'terms' && kind !== 'privacy' && kind !== 'imprint') throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  const href = legalHref(ctx.settings, kind);
  if (href.startsWith('https://')) return redirect(href);
  const doc = legalDoc(kind, ctx.lang, legalVars(ctx.env, ctx.shop, ctx.settings));
  const owner = ctx.viewer?.actor.type === 'user';
  const body = html`<article class="card legal">
    ${owner && kind !== 'imprint' ? notice('info', html`${ctx.t('legal.templateNote')} <a href="/merchant/setup#legal">${ctx.t('m.nav.home')} →</a>`) : ''}
    <h1>${doc.title}</h1>${doc.intro ? html`<p class="lead">${doc.intro}</p>` : ''}
    ${doc.sections.map((s) => html`<section><h2>${s.h}</h2>${s.p.map((p) => html`<p>${p}</p>`)}</section>`)}
    ${kind !== 'imprint' ? html`<p class="muted small">${ctx.t('legal.version', { v: TEMPLATE_VERSION.replace('template-', '') })}</p>` : ''}
  </article>`;
  return htmlResponse(page(ctx, { title: doc.title, area: 'public', narrow: true, body }), { private: false });
}

// ---- invited customers accept the terms once, before their first order ------------------------

export async function acceptGet(ctx: Ctx): Promise<Response> {
  const v = ctx.viewer;
  if (!v || v.actor.type !== 'partner' || !v.partner) return redirect('/login');
  const next = safeNext(ctx.url.searchParams.get('next'), '/catalog');
  const { t } = ctx;
  return htmlResponse(page(ctx, {
    title: t('legal.accept.title'), area: 'buyer', narrow: true,
    body: html`<section class="card"><h1>${t('legal.accept.title')}</h1><p>${t('legal.accept.body', { shop: ctx.shop!.legal_name })}</p>
      <form method="post" action="/legal/accept?next=${encodeURIComponent(next)}">${csrfField(ctx)}
        <label class="check"><input type="checkbox" name="terms" value="1" required> <span>${acceptLabel(ctx)}</span></label>
        <div class="actions"><button type="submit">${t('legal.accept.submit')}</button></div></form></section>`,
  }));
}

export async function acceptPost(ctx: Ctx): Promise<Response> {
  const v = ctx.viewer;
  if (!v || v.actor.type !== 'partner' || !v.partner) return redirect('/login');
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, v.session, f);
  if (f.terms !== '1') return acceptGet(ctx);
  await recordAcceptance(ctx.env, v.partner.id, ctx.settings, v.actor);
  return redirect(safeNext(ctx.url.searchParams.get('next'), '/catalog'));
}

export async function recordAcceptance(env: Env, partnerId: number, s: Settings, actor: Parameters<typeof audit>[1]): Promise<void> {
  const version = termsVersion(s);
  await run(env.DB, 'UPDATE partners SET terms_accepted_at = ?, terms_version = ? WHERE id = ?', now(), version, partnerId);
  await audit(env.DB, actor, 'partner.accept_terms', `partner:${partnerId}`, { version });
}

// ---- owner: legal texts + email -----------------------------------------------------------------

export async function legalSave(ctx: Ctx): Promise<Response> {
  const v = ctx.viewer;
  if (!v || v.actor.type !== 'user') return redirect('/login');
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, v.session, f);
  try {
    await updateSettings(ctx.env.DB, v.actor, { legal_terms_url: f.terms_url ?? '', legal_privacy_url: f.privacy_url ?? '', legal_confirmed: f.confirm === '1' });
  } catch (e) {
    if (e instanceof AppError) return home({ ...ctx, settings: ctx.settings }, { error: e.message });
    throw e;
  }
  return redirect('/merchant/setup?saved=1#legal');
}

export async function emailTest(ctx: Ctx): Promise<Response> {
  const v = ctx.viewer;
  if (!v || v.actor.type !== 'user' || !ctx.shop) return redirect('/login');
  assertCsrf(ctx.req, v.session, await readForm(ctx.req));
  if (!(await rateLimit(ctx.env.DB, `email-test:${v.actor.id}`, 5, 3_600_000))) return redirect('/merchant/setup?mail=limit#email');
  const r = await sendEmail(ctx.env, ctx.shop.email, ctx.t('m.email.testSubject'), ctx.t('m.email.testBody', { shop: ctx.shop.legal_name }));
  await audit(ctx.env.DB, v.actor, 'email.test', 'email', { delivered: r.delivered });
  return redirect(`/merchant/setup?mail=${r.delivered ? 'sent' : 'notsent'}#email`);
}
