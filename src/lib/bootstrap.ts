// Self-setup, so a fresh deploy needs no commands and no typed-in secrets:
//  • creates/updates the database tables from the bundled migrations on first start,
//  • generates the session and encryption secrets once (unless provided as Worker secrets),
//  • remembers the public URL (used for links in emails sent by the cron job).
// Everything is idempotent and safe under concurrent cold starts.

import m0001 from '../../migrations/0001_init.sql';
import m0002 from '../../migrations/0002_oauth.sql';
import m0003 from '../../migrations/0003_launch.sql';
import m0004 from '../../migrations/0004_any_shop.sql';
import type { Env } from './env';
import { randomToken } from './crypto';

const MIGRATIONS: { name: string; sql: string }[] = [{ name: '0001_init', sql: m0001 }, { name: '0002_oauth', sql: m0002 }, { name: '0003_launch', sql: m0003 }, { name: '0004_any_shop', sql: m0004 }];

/** Split a migration file into statements (full-line comments dropped; statements end with ";" at line end). */
export function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

let ready: Promise<void> | null = null;

export function ensureReady(env: Env): Promise<void> {
  ready ??= migrate(env.DB).catch((e) => { ready = null; throw e; });
  return ready;
}

async function migrate(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS _mt_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS _mt_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
  ]);
  const applied = async () => new Set(((await db.prepare('SELECT name FROM _mt_migrations').all<{ name: string }>()).results ?? []).map((r) => r.name));
  let done = await applied();
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    // Adopt databases whose schema was created by `wrangler d1 migrations apply` (older local setups).
    const hasShop = await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shop'").first();
    if (m.name === '0001_init' && hasShop) {
      await db.prepare('INSERT OR IGNORE INTO _mt_migrations (name, applied_at) VALUES (?, ?)').bind(m.name, Date.now()).run();
      continue;
    }
    try {
      await db.batch([
        ...splitSql(m.sql).map((s) => db.prepare(s)),
        db.prepare('INSERT INTO _mt_migrations (name, applied_at) VALUES (?, ?)').bind(m.name, Date.now()),
      ]);
    } catch (e) {
      done = await applied(); // another isolate may have applied it at the same moment
      if (!done.has(m.name)) throw e;
    }
  }
}

export interface Secrets { sessionSecret: string; encryptionKey: string }
let secrets: Promise<Secrets> | null = null;

/**
 * Worker secrets win if set (strongest: kept outside the database). Otherwise the app generates them
 * once and keeps them in its own table, so a Deploy-button install needs no typing.
 */
export function getSecrets(env: Env): Promise<Secrets> {
  secrets ??= loadSecrets(env).catch((e) => { secrets = null; throw e; });
  return secrets;
}

async function loadSecrets(env: Env): Promise<Secrets> {
  if (env.SESSION_SECRET && env.ENCRYPTION_KEY) return { sessionSecret: env.SESSION_SECRET, encryptionKey: env.ENCRYPTION_KEY };
  const db = env.DB;
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS _mt_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare("INSERT OR IGNORE INTO _mt_meta (name, value, updated_at) VALUES ('session_secret', ?, ?)").bind(randomToken(32), Date.now()),
    db.prepare("INSERT OR IGNORE INTO _mt_meta (name, value, updated_at) VALUES ('encryption_key', ?, ?)").bind(btoa(String.fromCharCode(...key)), Date.now()),
  ]);
  const rows = (await db.prepare("SELECT name, value FROM _mt_meta WHERE name IN ('session_secret', 'encryption_key')").all<{ name: string; value: string }>()).results ?? [];
  const get = (n: string) => rows.find((r) => r.name === n)?.value as string;
  return { sessionSecret: env.SESSION_SECRET || get('session_secret'), encryptionKey: env.ENCRYPTION_KEY || get('encryption_key') };
}

let rememberedOrigin: string | null = null;

/** Remember the public URL (cron jobs have no request to take it from). Writes only when it changes. */
export async function rememberOrigin(env: Env, origin: string): Promise<void> {
  if (rememberedOrigin === origin || !/^(https:\/\/|http:\/\/localhost[:/])/.test(origin + '/')) return;
  rememberedOrigin = origin;
  await env.DB.prepare(`INSERT INTO _mt_meta (name, value, updated_at) VALUES ('public_url', ?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE _mt_meta.value != excluded.value`).bind(origin, Date.now()).run();
}

export async function publicUrl(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM _mt_meta WHERE name = 'public_url'").first<{ value: string }>().catch(() => null);
  return row?.value ?? null;
}
