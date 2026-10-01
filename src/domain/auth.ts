// Human authentication: magic links + sessions, CSRF, and atomic rate limiting.

import { isLang, type Lang } from '../i18n';
import type { Actor, Env } from '../lib/env';
import { hmacHex, randomToken, safeEqual, sha256Hex } from '../lib/crypto';
import { getSecrets } from '../lib/bootstrap';
import { AppError } from '../lib/http';
import { now, one, run } from './db';

export const SESSION_COOKIE = '__Host-mt_session';
const LOCAL_SESSION_COOKIE = 'mt_session';

// Plain http on this machine (local development). Safari drops `Secure` cookies there — unlike Chrome it
// does not treat http://localhost as secure — so local http gets a plain cookie. Every real (https)
// address keeps the strict `__Host-` + Secure cookie.
const isLocalHttp = (req: Request) => {
  const u = new URL(req.url);
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
};
export const sessionCookieName = (req: Request) => (isLocalHttp(req) ? LOCAL_SESSION_COOKIE : SESSION_COOKIE);
/** Path/Secure/SameSite attributes for every cookie this app sets. */
export const cookieAttrs = (req: Request) => (isLocalHttp(req) ? 'Path=/; SameSite=Lax' : 'Path=/; Secure; SameSite=Lax');
const sessionCookie = (req: Request, id: string) => `${sessionCookieName(req)}=${id}; ${cookieAttrs(req)}; HttpOnly; Max-Age=${SESSION_TTL / 1000}`;
export const LANG_COOKIE = 'mt_lang';
const SESSION_TTL = 14 * 24 * 3600 * 1000;
const LINK_TTL = 15 * 60 * 1000;
export const INVITE_LINK_TTL = 7 * 24 * 3600 * 1000; // invites may be forwarded by hand

/** Fixed-window limiter; the increment is one atomic upsert (no read-then-write race). */
export async function rateLimit(db: D1Database, bucket: string, limit: number, windowMs: number): Promise<boolean> {
  const windowStart = Math.floor(now() / windowMs) * windowMs;
  const row = await db
    .prepare(`INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
              ON CONFLICT(bucket) DO UPDATE SET
                count = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.count + 1 ELSE 1 END,
                window_start = ?2
              RETURNING count`)
    .bind(bucket, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

// ---- Magic links -----------------------------------------------------------------------------

/** Create a single-use link token. Only its HMAC is stored, so a database leak can't be replayed. */
export async function createMagicLink(env: Env, email: string, ttlMs = LINK_TTL): Promise<string> {
  const token = randomToken(32);
  await run(env.DB, 'INSERT INTO magic_links (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
    await hmacHex((await getSecrets(env)).sessionSecret, `link:${token}`), email.trim().toLowerCase(), now(), now() + ttlMs);
  return token;
}

/** Consume a link exactly once (the UPDATE … WHERE used_at IS NULL is the race guard). */
export async function consumeMagicLink(env: Env, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const hash = await hmacHex((await getSecrets(env)).sessionSecret, `link:${token}`);
  const row = await one<{ email: string; expires_at: number; used_at: number | null }>(env.DB, 'SELECT email, expires_at, used_at FROM magic_links WHERE token_hash = ?', hash);
  if (!row || row.used_at || row.expires_at < now()) return null;
  const res = await run(env.DB, 'UPDATE magic_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', now(), hash);
  return res.meta.changes === 1 ? row.email : null;
}

// ---- Sessions ----------------------------------------------------------------------------------

export interface Session {
  idHash: string;
  csrf: string;
  subjectType: 'user' | 'partner_user';
  subjectId: number;
  /** Set when the session was extended on this request; the response must re-send the cookie. */
  renewedCookie?: string;
}

export async function createSession(env: Env, req: Request, subjectType: Session['subjectType'], subjectId: number): Promise<{ cookie: string; session: Session }> {
  const id = randomToken(32);
  const idHash = await sha256Hex(`session:${id}`);
  const csrf = randomToken(24);
  await run(env.DB, 'INSERT INTO sessions (id_hash, subject_type, subject_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    idHash, subjectType, subjectId, csrf, now(), now() + SESSION_TTL);
  return {
    cookie: sessionCookie(req, id),
    session: { idHash, csrf, subjectType, subjectId },
  };
}

export const clearSessionCookie = (req: Request) => `${sessionCookieName(req)}=; ${cookieAttrs(req)}; HttpOnly; Max-Age=0`;

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function getSession(env: Env, req: Request): Promise<Session | null> {
  const id = readCookie(req, sessionCookieName(req));
  if (!id || !/^[A-Za-z0-9_-]{20,100}$/.test(id)) return null;
  const idHash = await sha256Hex(`session:${id}`);
  const row = await one<{ subject_type: Session['subjectType']; subject_id: number; csrf: string; expires_at: number }>(env.DB,
    'SELECT subject_type, subject_id, csrf, expires_at FROM sessions WHERE id_hash = ?', idHash);
  if (!row || row.expires_at < now()) return null;
  const session: Session = { idHash, csrf: row.csrf, subjectType: row.subject_type, subjectId: row.subject_id };
  // Sliding expiry: extend at most once a day while the session is in use.
  if (row.expires_at - now() < SESSION_TTL - 24 * 3600 * 1000) {
    await run(env.DB, 'UPDATE sessions SET expires_at = ? WHERE id_hash = ?', now() + SESSION_TTL, idHash);
    session.renewedCookie = sessionCookie(req, id);
  }
  return session;
}

export const destroySession = (env: Env, s: Session) => run(env.DB, 'DELETE FROM sessions WHERE id_hash = ?', s.idHash);

export interface Viewer {
  session: Session;
  actor: Actor;
  /** For partner users: the company's status is re-checked on EVERY request (suspension is immediate). */
  partner?: { id: number; status: string; language: Lang; company: string };
}

/** Resolve the signed-in human and their current permissions. */
export async function getViewer(env: Env, req: Request): Promise<Viewer | null> {
  const session = await getSession(env, req);
  if (!session) return null;
  if (session.subjectType === 'user') {
    const u = await one<{ id: number; email: string; role: 'owner' | 'staff' }>(env.DB, 'SELECT id, email, role FROM users WHERE id = ?', session.subjectId);
    if (!u) return null;
    return { session, actor: { type: 'user', id: u.id, label: u.email, role: u.role } };
  }
  const p = await one<{ id: number; partner_id: number; email: string; status: string; language: string; company: string }>(env.DB,
    `SELECT pu.id, pu.partner_id, pu.email, p.status, p.language, p.company FROM partner_users pu JOIN partners p ON p.id = pu.partner_id WHERE pu.id = ?`, session.subjectId);
  if (!p) return null;
  return {
    session,
    actor: { type: 'partner', id: p.id, partnerId: p.partner_id, label: p.email },
    partner: { id: p.partner_id, status: p.status, language: isLang(p.language) ? p.language : 'de', company: p.company },
  };
}

/** Who owns this email: a merchant user or a partner user? */
export async function lookupLogin(db: D1Database, email: string): Promise<{ type: 'user' | 'partner_user'; id: number } | null> {
  const e = email.trim().toLowerCase();
  const u = await one<{ id: number }>(db, 'SELECT id FROM users WHERE email = ?', e);
  if (u) return { type: 'user', id: u.id };
  const pu = await one<{ id: number }>(db, 'SELECT id FROM partner_users WHERE email = ?', e);
  return pu ? { type: 'partner_user', id: pu.id } : null;
}

// ---- CSRF --------------------------------------------------------------------------------------

/**
 * Browser POSTs must come from our own origin (Origin / Sec-Fetch-Site), and signed-in forms must also
 * carry the session's CSRF token. Agents never use cookies, so the MCP/REST surfaces are not affected.
 */
export function assertSameOrigin(req: Request): void {
  const self = new URL(req.url).origin;
  const originHeader = req.headers.get('Origin');
  if (originHeader) {
    if (originHeader !== self) throw new AppError('CSRF', 'Cross-site request blocked.', 403);
    return;
  }
  const site = req.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') throw new AppError('CSRF', 'Cross-site request blocked.', 403);
}

export function assertCsrf(req: Request, session: Session, form: Record<string, string>): void {
  assertSameOrigin(req);
  if (!form._csrf || !safeEqual(form._csrf, session.csrf)) throw new AppError('CSRF', 'Invalid form token.', 403);
}
