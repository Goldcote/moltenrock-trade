// Executes a tool call for an authenticated agent: scope check → argument validation → rate limit →
// idempotency (reserve-then-complete, so concurrent retries can't run twice) → handler.

import type { Actor, Env } from '../lib/env';
import { sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/http';
import { rateLimit } from '../domain/auth';
import { now, one, run } from '../domain/db';
import { scopeAllows } from '../domain/tokens';
import { validateArgs } from './schema';
import { toolByName, TOOLS } from './tools';

const PENDING = '__pending__';

const stable = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
    : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : JSON.stringify(v);

export const toolsFor = (actor: Actor & { type: 'agent' }) => TOOLS.filter((t) => scopeAllows(actor.scope, t.scope));

export async function callTool(env: Env, actor: Actor & { type: 'agent' }, baseUrl: string, name: string, rawArgs: unknown): Promise<unknown> {
  const tool = toolByName(name);
  if (!tool) throw new AppError('UNKNOWN_TOOL', `Unknown tool '${name}'.`, 404);
  if (!scopeAllows(actor.scope, tool.scope))
    throw new AppError('INSUFFICIENT_SCOPE', `'${name}' needs "${tool.scope}" access; this token has "${actor.scope}". The owner can create a token with more access on the merchant page.`, 403);
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const errors = validateArgs(tool.inputSchema, args);
  if (errors.length) throw new AppError('INVALID_ARGUMENTS', errors.join('; '), 400, { errors });
  if (!(await rateLimit(env.DB, `agent:${actor.id}`, 120, 60_000))) throw new AppError('RATE_LIMITED', 'Too many calls; max 120 per minute per token.', 429);

  const key = tool.mutates && typeof args.idempotency_key === 'string' ? args.idempotency_key : null;
  if (!key) return tool.handler(args, { env, actor, baseUrl });

  const { idempotency_key: _k, ...rest } = args;
  const hash = await sha256Hex(`${name}:${stable(rest)}`);
  const reserved = await run(env.DB, 'INSERT OR IGNORE INTO idempotency (token_id, key, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)', actor.id, key, hash, PENDING, now());
  if (reserved.meta.changes === 0) {
    const prev = await one<{ request_hash: string; response: string }>(env.DB, 'SELECT request_hash, response FROM idempotency WHERE token_id = ? AND key = ?', actor.id, key);
    if (!prev || prev.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This idempotency_key was already used with different arguments.', 409);
    if (prev.response === PENDING) throw new AppError('IN_PROGRESS', 'A call with this idempotency_key is still running; retry shortly.', 409);
    return JSON.parse(prev.response);
  }
  try {
    const result = await tool.handler(args, { env, actor, baseUrl });
    await run(env.DB, 'UPDATE idempotency SET response = ? WHERE token_id = ? AND key = ?', JSON.stringify(result ?? null), actor.id, key);
    return result;
  } catch (e) {
    await run(env.DB, 'DELETE FROM idempotency WHERE token_id = ? AND key = ? AND response = ?', actor.id, key, PENDING); // let a real retry run
    throw e;
  }
}
