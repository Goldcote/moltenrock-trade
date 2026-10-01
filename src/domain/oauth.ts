// One-address agent connect (OAuth 2.1 authorization code + PKCE, as used by MCP clients such as
// Claude). The owner pastes the portal address into their agent, signs in here and clicks Allow;
// the agent receives an ordinary agent token — same scopes, same revocation, same audit log.
// Public clients only need PKCE; clients that asked for a secret at registration must also send it.

import type { Actor, AgentScope, Env } from '../lib/env';
import { randomToken, safeEqual, sha256Hex, toBase64Url } from '../lib/crypto';
import { AppError } from '../lib/http';
import { now, one, run } from './db';
import { createAgentToken, revokeAgentToken, SCOPES } from './tokens';

const CODE_TTL = 10 * 60 * 1000;

export interface OAuthClient { client_id: string; client_name: string; redirect_uris: string[]; has_secret: boolean }

/** OAuth-style error: `error` is the RFC 6749 code, the message is human-readable. */
export class OAuthError extends AppError {
  constructor(readonly error: string, message: string, status = 400) { super(error, message, status); }
}

// Schemes that must never be a redirect target (script execution or local files).
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https anywhere, http only on this machine (native apps), or an app's own scheme (e.g. cursor://). */
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || uri.length > 500) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return !BLOCKED_SCHEMES.has(u.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

export async function registerClient(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every((u) => typeof u === 'string' && isAllowedRedirectUri(u)))
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1–5 https URLs, http://localhost URLs or app-specific URLs');
  const name = (typeof body.client_name === 'string' ? body.client_name : 'AI agent').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'AI agent';
  const method = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
  const wantsSecret = method === 'client_secret_post' || method === 'client_secret_basic';
  const clientId = `mtc_${randomToken(18)}`;
  const secret = wantsSecret ? `mts_${randomToken(32)}` : null;
  await run(db, 'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    clientId, name, JSON.stringify(uris), secret ? await sha256Hex(secret) : null, now());
  return {
    client_id: clientId, client_id_issued_at: Math.floor(now() / 1000), client_name: name, redirect_uris: uris,
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: wantsSecret ? method : 'none',
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  };
}

export async function getClient(db: D1Database, clientId: string): Promise<OAuthClient | null> {
  const row = await one<{ client_id: string; client_name: string; redirect_uris: string; secret_hash: string | null }>(db,
    'SELECT client_id, client_name, redirect_uris, secret_hash FROM oauth_clients WHERE client_id = ?', clientId);
  return row && { client_id: row.client_id, client_name: row.client_name, redirect_uris: JSON.parse(row.redirect_uris) as string[], has_secret: !!row.secret_hash };
}

export interface AuthorizeRequest { client: OAuthClient; redirect_uri: string; state: string; code_challenge: string; scope: AgentScope }

/**
 * Validate an authorization request. Problems with the client or redirect address are shown on our
 * own page (never redirected, so the endpoint can't be used as an open redirect); everything else
 * goes back to the agent app as an OAuth error.
 */
export async function parseAuthorizeRequest(db: D1Database, q: URLSearchParams, mcpUrl: string, baseUrl: string):
  Promise<{ ok: AuthorizeRequest } | { fatal: string } | { redirectError: { uri: string; error: string; description: string; state: string } }> {
  const client = await getClient(db, q.get('client_id') ?? '');
  if (!client) return { fatal: 'This agent app is not registered with this portal. Start connecting again from your agent.' };
  const redirectUri = q.get('redirect_uri') ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0]! : '');
  if (!client.redirect_uris.includes(redirectUri)) return { fatal: 'The return address does not match the agent app’s registration.' };
  const state = q.get('state') ?? '';
  const fail = (error: string, description: string) => ({ redirectError: { uri: redirectUri, error, description, state } });
  if (q.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported');
  const challenge = q.get('code_challenge') ?? '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  const resource = q.get('resource');
  if (resource && ![mcpUrl, `${mcpUrl}/`, baseUrl, `${baseUrl}/`].includes(resource)) return fail('invalid_target', 'Unknown resource');
  const requested = (q.get('scope') ?? '').split(/\s+/).filter((s): s is AgentScope => SCOPES.includes(s as AgentScope));
  const scope: AgentScope = requested.includes('configure') || !requested.length ? 'configure' : requested.includes('operate') ? 'operate' : 'read';
  return { ok: { client, redirect_uri: redirectUri, state, code_challenge: challenge, scope } };
}

export async function issueCode(db: D1Database, req: AuthorizeRequest, userId: number, scope: AgentScope): Promise<string> {
  const code = randomToken(32);
  await run(db, 'INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scope, user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    await sha256Hex(`code:${code}`), req.client.client_id, req.redirect_uri, req.code_challenge, scope, userId, now() + CODE_TTL);
  return code;
}

const s256 = async (verifier: string) => toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

/** Token endpoint, grant_type=authorization_code. Single-use codes; a replayed code revokes what it issued. */
export async function exchangeCode(env: Env, form: Record<string, string>, basicAuth: { id: string; secret: string } | null) {
  if (form.grant_type !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Only grant_type=authorization_code is supported');
  const clientId = basicAuth?.id ?? form.client_id ?? '';
  const client = await getClient(env.DB, clientId);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);
  if (client.has_secret) {
    const secret = basicAuth?.secret ?? form.client_secret ?? '';
    const row = await one<{ secret_hash: string }>(env.DB, 'SELECT secret_hash FROM oauth_clients WHERE client_id = ?', clientId);
    if (!secret || !row || !safeEqual(await sha256Hex(secret), row.secret_hash)) throw new OAuthError('invalid_client', 'Client authentication failed', 401);
  }
  const codeHash = await sha256Hex(`code:${form.code ?? ''}`);
  const code = await one<{ client_id: string; redirect_uri: string; code_challenge: string; scope: AgentScope; user_id: number; expires_at: number; used_at: number | null; token_id: number | null }>(env.DB,
    'SELECT client_id, redirect_uri, code_challenge, scope, user_id, expires_at, used_at, token_id FROM oauth_codes WHERE code_hash = ?', codeHash);
  if (!code || code.client_id !== clientId) throw new OAuthError('invalid_grant', 'Invalid authorization code');
  const owner = await one<{ id: number; email: string; role: 'owner' | 'staff' }>(env.DB, 'SELECT id, email, role FROM users WHERE id = ?', code.user_id);
  const actor: Actor = { type: 'user', id: code.user_id, label: owner?.email ?? String(code.user_id), role: owner?.role ?? 'staff' };
  if (code.used_at) {
    if (code.token_id) await revokeAgentToken(env.DB, actor, code.token_id); // RFC 6749 §4.1.2: replay ⇒ revoke
    throw new OAuthError('invalid_grant', 'Authorization code already used');
  }
  if (code.expires_at < now()) throw new OAuthError('invalid_grant', 'Authorization code expired');
  if (form.redirect_uri && form.redirect_uri !== code.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(form.code_verifier ?? '') || !safeEqual(await s256(form.code_verifier!), code.code_challenge))
    throw new OAuthError('invalid_grant', 'PKCE verification failed');
  const consumed = await run(env.DB, 'UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL', now(), codeHash);
  if (consumed.meta.changes !== 1) throw new OAuthError('invalid_grant', 'Authorization code already used');
  const { token, row } = await createAgentToken(env.DB, actor, client.client_name, code.scope, { oauthClientId: clientId });
  await run(env.DB, 'UPDATE oauth_codes SET token_id = ? WHERE code_hash = ?', row.id, codeHash);
  return { access_token: token, token_type: 'Bearer', scope: code.scope };
}

export function serverMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${baseUrl}/llms.txt`,
  };
}

export function resourceMetadata(baseUrl: string, shopName: string | null) {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: shopName ? `${shopName} trade portal` : 'MoltenRock Trade portal',
    resource_documentation: `${baseUrl}/llms.txt`,
  };
}
