// Agent access tokens. Created by the owner (a human), shown once, stored hashed, scoped, revocable.

import type { Actor, AgentScope, Env } from '../lib/env';
import { randomToken, sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/http';
import { all, audit, now, one, run } from './db';

export const SCOPES: AgentScope[] = ['read', 'operate', 'configure'];
const RANK: Record<AgentScope, number> = { read: 0, operate: 1, configure: 2 };
export const scopeAllows = (have: AgentScope, need: AgentScope): boolean => RANK[have] >= RANK[need];

export interface TokenRow { id: number; name: string; scope: AgentScope; created_at: number; last_used_at: number | null; revoked_at: number | null }

export async function createAgentToken(db: D1Database, actor: Actor, name: string, scope: AgentScope, opts: { oauthClientId?: string } = {}): Promise<{ token: string; row: TokenRow }> {
  if (actor.type !== 'user' || actor.role !== 'owner') throw new AppError('HUMAN_ONLY', 'Only the shop owner can create agent access.', 403);
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new AppError('REQUIRED', 'Agent name is required');
  if (!SCOPES.includes(scope)) throw new AppError('INVALID_SCOPE', `scope must be one of ${SCOPES.join(', ')}`);
  const token = `mt_${randomToken(32)}`;
  // Reconnecting the same agent app replaces its previous access instead of piling up tokens.
  if (opts.oauthClientId) await run(db, 'UPDATE agent_tokens SET revoked_at = ? WHERE oauth_client_id = ? AND revoked_at IS NULL', now(), opts.oauthClientId);
  const res = await run(db, 'INSERT INTO agent_tokens (name, token_hash, scope, created_by, created_at, oauth_client_id) VALUES (?, ?, ?, ?, ?, ?)',
    clean, await sha256Hex(token), scope, actor.id, now(), opts.oauthClientId ?? null);
  const row = (await one<TokenRow>(db, 'SELECT id, name, scope, created_at, last_used_at, revoked_at FROM agent_tokens WHERE id = ?', res.meta.last_row_id)) as TokenRow;
  await audit(db, actor, 'agent_token.create', `agent_token:${row.id}`, { name: clean, scope, ...(opts.oauthClientId ? { via: 'connect' } : {}) });
  return { token, row };
}

export async function revokeAgentToken(db: D1Database, actor: Actor, id: number): Promise<void> {
  if (actor.type !== 'user' || actor.role !== 'owner') throw new AppError('HUMAN_ONLY', 'Only the shop owner can revoke agent access.', 403);
  await run(db, 'UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now(), id);
  await audit(db, actor, 'agent_token.revoke', `agent_token:${id}`);
}

export const listAgentTokens = (db: D1Database) =>
  all<TokenRow>(db, 'SELECT id, name, scope, created_at, last_used_at, revoked_at FROM agent_tokens ORDER BY revoked_at IS NOT NULL, created_at DESC');

/** Resolve "Authorization: Bearer mt_…" to an agent actor. Revocation takes effect on the next request. */
export async function authenticateAgent(env: Env, req: Request): Promise<Actor & { type: 'agent' }> {
  const header = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(mt_[A-Za-z0-9_-]{20,100})$/.exec(header);
  if (!m) throw new AppError('UNAUTHENTICATED', 'Send "Authorization: Bearer <agent token>". Create one on the merchant page.', 401);
  const row = await one<TokenRow>(env.DB, 'SELECT id, name, scope, created_at, last_used_at, revoked_at FROM agent_tokens WHERE token_hash = ?', await sha256Hex(m[1] as string));
  if (!row || row.revoked_at) throw new AppError('UNAUTHENTICATED', 'This agent token is unknown or has been revoked.', 401);
  await run(env.DB, 'UPDATE agent_tokens SET last_used_at = ? WHERE id = ?', now(), row.id);
  return { type: 'agent', id: row.id, label: row.name, scope: row.scope };
}
