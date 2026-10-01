import { actorLabel, isDev, type Actor, type Env } from '../lib/env';

export const now = (): number => Date.now();

export async function one<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

/** Append-only audit trail. Every write in the domain layer records who did it (human, partner or agent). */
export async function audit(db: D1Database, actor: Actor, action: string, target = '', detail: Record<string, unknown> = {}): Promise<void> {
  await run(db, 'INSERT INTO audit_log (at, actor_type, actor_label, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)',
    now(), actor.type, actorLabel(actor), action, target, JSON.stringify(detail));
}

export const emailConfigured = (env: Env): boolean => !!(env.RESEND_API_KEY && env.MAIL_FROM);

/**
 * Send an email if a provider is configured (Resend: RESEND_API_KEY + MAIL_FROM). In local development
 * every message also lands in the dev outbox (/dev/mail). In production without a provider nothing is
 * stored — sign-in links must never sit in the database — and the merchant forwards links instead
 * (Approvals → Partners → "Create sign-in link"). MoltenMail drafts can plug in here later.
 */
export async function sendEmail(env: Env, to: string, subject: string, body: string): Promise<{ delivered: boolean }> {
  if (isDev(env)) await run(env.DB, 'INSERT INTO outbox_emails (to_addr, subject, body, created_at) VALUES (?, ?, ?, ?)', to, subject, body, now());
  if (!emailConfigured(env)) return { delivered: false };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text: body }),
    });
    if (!res.ok) console.error('email provider refused', res.status);
    return { delivered: res.ok };
  } catch (e) {
    console.error('email send failed', e);
    return { delivered: false };
  }
}

export const origin = (req: Request): string => new URL(req.url).origin;
