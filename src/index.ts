// MoltenRock Trade Worker entry: routing, per-request context, error handling, and the cron that confirms
// orders whose cancel window has passed.

import { isLang, negotiateLang, translator } from './i18n';
import { ensureReady, publicUrl, rememberOrigin } from './lib/bootstrap';
import { isDev, type Env } from './lib/env';
import { AppError, htmlResponse, jsonResponse, withHeaders } from './lib/http';
import { Router } from './lib/router';
import { cookieAttrs, getViewer, LANG_COOKIE, readCookie } from './domain/auth';
import { approvalsCount } from './domain/dashboard';
import { finalizeDueOrders } from './domain/orders';
import { getSettings, getShop } from './domain/settings';
import { handleMcp } from './mcp/server';
import { handleRestList, handleRestTool, llmsTxt, openApi } from './mcp/rest';
import * as buyer from './web/buyer';
import type { Ctx } from './web/context';
import { messagePage } from './web/layout';
import { dashboard, liveFragment } from './web/dashboard';
import { exportDownload, exportsPage, signedDownload } from './web/exports';
import { acceptGet, acceptPost, emailTest, legalPage, legalSave } from './web/legal';
import { checkForUpdates } from './lib/updates';
import * as merchant from './web/merchant';
import { authorizeGet, authorizePost, handleOAuthApi } from './web/oauth';
import { devDemo, devMail, statusPage, updateCheckNow } from './web/status';

const router = new Router<Ctx>()
  // buyer storefront
  .get('/', buyer.landing)
  .get('/apply', buyer.applyGet).post('/apply', buyer.applyPost)
  .get('/login', (c) => buyer.loginGet(c)).post('/login', buyer.loginPost)
  .get('/auth/verify', buyer.verifyGet).post('/auth/verify', buyer.verifyPost)
  .post('/logout', buyer.logout)
  .get('/catalog', buyer.catalog)
  .post('/cart/add', buyer.cartAdd)
  .get('/cart', (c) => buyer.cartGet(c)).post('/cart/update', buyer.cartUpdate)
  .post('/checkout', buyer.checkoutPost)
  .get('/orders', buyer.ordersList)
  .get('/orders/:ref', (c, p) => buyer.orderDetail(c, p.ref as string))
  .post('/orders/:ref/cancel', (c, p) => buyer.orderCancel(c, p.ref as string))
  .post('/orders/:ref/reorder', (c, p) => buyer.orderReorder(c, p.ref as string))
  .get('/invoices/:id', (c, p) => buyer.invoiceDownload(c, p.id as string))
  // legal pages (merchant's own links or the built-in templates) and the one-time terms acceptance
  .get('/legal/accept', acceptGet).post('/legal/accept', acceptPost)
  .get('/legal/:doc', (c, p) => legalPage(c, p.doc as string))
  // the merchant's three human pages (+ read-only status)
  .get('/merchant/signup', merchant.signupGet).post('/merchant/signup', merchant.signupPost)
  .get('/merchant', dashboard)
  .get('/merchant/live/:part', (c, p) => liveFragment(c, p.part as string))
  .get('/merchant/setup', (c) => merchant.home(c, { saved: c.url.searchParams.has('saved') }))
  .get('/merchant/progress', merchant.progress)
  .post('/merchant/tokens', merchant.tokenCreate)
  .post('/merchant/tokens/:id/revoke', (c, p) => merchant.tokenRevoke(c, p.id as string))
  .post('/merchant/business', merchant.businessSave)
  .post('/merchant/legal', legalSave)
  .post('/merchant/email-test', emailTest)
  .get('/merchant/exports', exportsPage)
  .get('/merchant/exports/:file', (c, p) => exportDownload(c, p.file as string))
  .post('/merchant/update-check', updateCheckNow)
  .get('/merchant/approvals', (c) => merchant.approvals(c))
  .post('/merchant/partners/:id/decide', (c, p) => merchant.partnerDecide(c, p.id as string))
  .post('/merchant/partners/:id/link', (c, p) => merchant.partnerLink(c, p.id as string))
  .post('/merchant/orders/:id/decide', (c, p) => merchant.orderDecide(c, p.id as string))
  .post('/merchant/prices', merchant.pricesDecide)
  .post('/merchant/signin-link', merchant.signinLink)
  .post('/merchant/proposals/:id/decide', (c, p) => merchant.proposalDecide(c, p.id as string))
  .get('/status', statusPage)
  .get('/exports/:file', (c, p) => signedDownload(c, p.file as string))
  // one-address agent connect: the owner's consent page
  .get('/oauth/authorize', authorizeGet).post('/oauth/authorize', authorizePost)
  // agents
  .get('/llms.txt', (c) => llmsTxt(c.env, c.baseUrl))
  .get('/api/v1/openapi.json', (c) => jsonResponse(openApi(c.baseUrl)))
  .get('/api/v1/tools', (c) => handleRestList(c.req, c.env))
  .post('/api/v1/tools/:name', (c, p) => handleRestTool(c.req, c.env, c.baseUrl, p.name as string))
  // local development only
  .get('/dev/mail', devMail)
  .post('/dev/demo', devDemo);

async function buildCtx(req: Request, env: Env): Promise<Ctx> {
  const url = new URL(req.url);
  const [shop, settings, viewer] = await Promise.all([getShop(env.DB), getSettings(env.DB), getViewer(env, req)]);
  const lang = negotiateLang({
    query: url.searchParams.get('lang'), cookie: readCookie(req, LANG_COOKIE), profile: viewer?.partner?.language,
    accept: req.headers.get('Accept-Language'), fallback: shop?.default_lang ?? 'de',
  });
  const approvals = viewer?.actor.type === 'user' ? await approvalsCount(env.DB) : 0;
  return { req, env, url, baseUrl: url.origin, shop, settings, viewer, lang, t: translator(lang), approvals };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Static assets (CSS/JS) come straight from the assets binding — no database needed.
    if (/^\/(styles\.css|invoice\.css|app\.js|favicon\.ico)$/.test(url.pathname)) {
      const res = await env.ASSETS.fetch(req);
      return withHeaders(res, { 'Cache-Control': 'public, max-age=300' });
    }

    // First start of a fresh deploy: create tables and secrets (no commands needed).
    await ensureReady(env);
    await rememberOrigin(env, url.origin);

    // Agent connect (OAuth discovery, registration, token) — no cookies involved.
    const oauth = await handleOAuthApi(req, env, url);
    if (oauth) return oauth;

    // Agents: MCP is handled before any cookie/session work.
    if (url.pathname === '/mcp') {
      try { await finalizeDueOrders(env, url.origin); } catch (e) { console.error(e); }
      return handleMcp(req, env, url.origin);
    }

    let ctx: Ctx | null = null;
    try {
      await finalizeDueOrders(env, url.origin); // cheap; keeps order states fresh between cron ticks
      ctx = await buildCtx(req, env);
      const match = router.match(req.method, url.pathname);
      if (!match) throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
      if ('methodNotAllowed' in match) return withHeaders(new Response('Method not allowed', { status: 405 }));
      const res = await match.handler(ctx, match.params);
      const q = url.searchParams.get('lang');
      const renewed = ctx.viewer?.session.renewedCookie;
      if (isLang(q) || renewed) {
        const r = new Response(res.body, res);
        if (isLang(q)) r.headers.append('Set-Cookie', `${LANG_COOKIE}=${q}; ${cookieAttrs(req)}; Max-Age=31536000`);
        // Sliding session: re-send the cookie unless this response already sets a new session.
        if (renewed && !(res.headers.get('Set-Cookie') ?? '').includes('mt_session')) r.headers.append('Set-Cookie', renewed);
        return r;
      }
      return res;
    } catch (e) {
      const err = e instanceof AppError ? e : null;
      if (!err) console.error('unhandled', e);
      const status = err?.status ?? 500;
      if (url.pathname.startsWith('/api/')) return jsonResponse({ ok: false, error: { code: err?.code ?? 'INTERNAL', message: err?.message ?? 'Unexpected error' } }, status);
      if (!ctx) return withHeaders(new Response('Something went wrong', { status }));
      const message = err?.code === 'CSRF' ? ctx.t('err.csrf') : err?.message ?? ctx.t('err.generic');
      const m = messagePage(ctx, status === 404 ? ctx.t('err.notFound') : ctx.t('err.generic'), isDev(env) || err ? message : ctx.t('err.generic'), 'public', status);
      return htmlResponse(m.body, { status: m.status });
    }
  },

  async scheduled(_event: ScheduledController, env: Env, c: ExecutionContext): Promise<void> {
    c.waitUntil((async () => {
      await ensureReady(env);
      const base = await publicUrl(env);
      if (base) await finalizeDueOrders(env, base); // before the first visit there is nothing to confirm
      if ((await getSettings(env.DB)).update_check) await checkForUpdates(env); // at most once a day
    })());
  },
} satisfies ExportedHandler<Env>;
