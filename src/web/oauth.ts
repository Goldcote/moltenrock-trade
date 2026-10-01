// HTTP side of one-address agent connect: discovery documents, client registration, the owner's
// consent page and the token endpoint. See src/domain/oauth.ts for the rules.

import type { AgentScope, Env } from '../lib/env';
import { AppError, htmlResponse, jsonResponse, readForm, redirect, withHeaders, SECURITY_HEADERS } from '../lib/http';
import { html } from '../lib/html';
import { assertCsrf, rateLimit } from '../domain/auth';
import { exchangeCode, issueCode, OAuthError, parseAuthorizeRequest, registerClient, resourceMetadata, serverMetadata, type AuthorizeRequest } from '../domain/oauth';
import { getShop } from '../domain/settings';
import { SCOPES } from '../domain/tokens';
import type { Ctx } from './context';
import { csrfField, messagePage, notice, page } from './layout';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const oauthJson = (data: unknown, status = 200) => jsonResponse(data, status, CORS);
const oauthErrorJson = (e: unknown) => {
  if (e instanceof OAuthError) return oauthJson({ error: e.error, error_description: e.message }, e.status);
  if (e instanceof AppError) return oauthJson({ error: 'invalid_request', error_description: e.message }, e.status);
  console.error('oauth', e);
  return oauthJson({ error: 'server_error', error_description: 'Unexpected error' }, 500);
};

function basicAuth(req: Request): { id: string; secret: string } | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return null;
  try {
    const [id, ...rest] = atob(m[1]!).split(':');
    return { id: decodeURIComponent(id ?? ''), secret: decodeURIComponent(rest.join(':')) };
  } catch { return null; }
}

async function readBody(req: Request): Promise<Record<string, string>> {
  if ((req.headers.get('Content-Type') ?? '').includes('application/json')) {
    const j = await req.json().catch(() => ({})) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  }
  return readForm(req);
}

/** Discovery, registration and token endpoints (no cookies involved). Returns null for other paths. */
export async function handleOAuthApi(req: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;
  const base = url.origin;
  const isOAuthPath = p.startsWith('/.well-known/oauth-') || p === '/.well-known/openid-configuration' || p === '/oauth/register' || p === '/oauth/token';
  if (!isOAuthPath) return null;
  if (req.method === 'OPTIONS') return withHeaders(new Response(null, { status: 204, headers: CORS }));

  if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration' || p === '/.well-known/oauth-authorization-server/mcp')
    return oauthJson(serverMetadata(base));
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')
    return oauthJson(resourceMetadata(base, (await getShop(env.DB))?.legal_name ?? null));

  if (p === '/oauth/register' && req.method === 'POST') {
    try {
      const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
      if (!(await rateLimit(env.DB, `oauth-register:${ip}`, 20, 3_600_000))) throw new OAuthError('slow_down', 'Too many registrations, try again later', 429);
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthError('invalid_client_metadata', 'Send the client metadata as a JSON object');
      return oauthJson(await registerClient(env.DB, body as Record<string, unknown>), 201);
    } catch (e) { return oauthErrorJson(e); }
  }
  if (p === '/oauth/token' && req.method === 'POST') {
    try {
      const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
      if (!(await rateLimit(env.DB, `oauth-token:${ip}`, 60, 600_000))) throw new OAuthError('slow_down', 'Too many requests', 429);
      return oauthJson(await exchangeCode(env, await readBody(req), basicAuth(req)));
    } catch (e) { return oauthErrorJson(e); }
  }
  return oauthJson({ error: 'invalid_request', error_description: 'Method not allowed' }, 405);
}

// ---- Consent (the owner's decision) ------------------------------------------------------------

function returnHost(uri: string): string {
  const u = new URL(uri);
  return u.host ? `${u.protocol === 'https:' ? '' : u.protocol + '//'}${u.host}` : u.protocol;
}

function backToApp(uri: string, params: Record<string, string>): Response {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return redirect(u.toString());
}

async function parsed(ctx: Ctx) {
  const r = await parseAuthorizeRequest(ctx.env.DB, ctx.url.searchParams, `${ctx.baseUrl}/mcp`, ctx.baseUrl);
  if ('fatal' in r) {
    const m = messagePage(ctx, ctx.t('oauth.error.title'), r.fatal, 'public', 400);
    return htmlResponse(m.body, { status: m.status });
  }
  if ('redirectError' in r) return backToApp(r.redirectError.uri, { error: r.redirectError.error, error_description: r.redirectError.description, state: r.redirectError.state, iss: ctx.baseUrl });
  return r.ok;
}

function ownerGate(ctx: Ctx): Response | null {
  if (!ctx.shop) return redirect('/merchant/signup');
  if (!ctx.viewer) return redirect(`/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
  if (ctx.viewer.actor.type !== 'user' || ctx.viewer.actor.role !== 'owner') {
    const m = messagePage(ctx, ctx.t('oauth.error.title'), ctx.t('oauth.ownerOnly'), 'merchant', 403);
    return htmlResponse(m.body, { status: m.status });
  }
  return null;
}

export async function authorizeGet(ctx: Ctx): Promise<Response> {
  const r = await parsed(ctx);
  if (r instanceof Response) return r;
  const gate = ownerGate(ctx);
  if (gate) return gate;
  const { t } = ctx;
  const client = r.client.client_name;
  const body = html`<section class="card consent"><h1>${t('oauth.title', { client })}</h1>
    <p>${t('oauth.lead', { client, shop: ctx.shop!.legal_name })}</p>
    <form method="post" action="/oauth/authorize${ctx.url.search}">${csrfField(ctx)}
      <fieldset class="choices"><legend>${t('oauth.scope')}</legend>
        ${SCOPES.slice().reverse().map((s) => html`<label class="choice"><input type="radio" name="scope" value="${s}" ${s === r.scope ? html`checked` : ''}>
          <span><strong>${t(`oauth.scope.${s}.title` as never)}</strong><br><small>${t(`oauth.scope.${s}` as never)}</small></span></label>`)}
      </fieldset>
      ${notice('info', t('oauth.never'))}
      <p class="muted">${t('oauth.return', { host: returnHost(r.redirect_uri) })} ${t('oauth.revoke')}</p>
      <div class="actions"><button name="decision" value="allow">${t('oauth.allow')}</button><button name="decision" value="deny" class="secondary">${t('oauth.deny')}</button></div>
    </form></section>`;
  const res = htmlResponse(page(ctx, { title: t('oauth.title', { client }), area: 'merchant', narrow: true, body }));
  // The form's response redirects to the agent app, so CSP form-action must allow that one origin.
  const target = new URL(r.redirect_uri);
  const extra = target.protocol === 'https:' || target.protocol === 'http:' ? target.origin : `${target.protocol}`;
  return withHeaders(res, { 'Content-Security-Policy': SECURITY_HEADERS['Content-Security-Policy']!.replace("form-action 'self'", `form-action 'self' ${extra}`) });
}

export async function authorizePost(ctx: Ctx): Promise<Response> {
  const r = await parsed(ctx);
  if (r instanceof Response) return r;
  const gate = ownerGate(ctx);
  if (gate) return gate;
  const f = await readForm(ctx.req);
  assertCsrf(ctx.req, ctx.viewer!.session, f);
  const req: AuthorizeRequest = r;
  if (f.decision !== 'allow') return backToApp(req.redirect_uri, { error: 'access_denied', error_description: 'The owner declined', state: req.state, iss: ctx.baseUrl });
  const scope = (SCOPES.includes(f.scope as AgentScope) ? f.scope : req.scope) as AgentScope;
  const owner = ctx.viewer!.actor as { type: 'user'; id: number };
  const code = await issueCode(ctx.env.DB, req, owner.id, scope);
  return backToApp(req.redirect_uri, { code, state: req.state, iss: ctx.baseUrl });
}
