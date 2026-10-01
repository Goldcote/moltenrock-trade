// Numbers for the owner's dashboard (and the read-only status page). One pass of small aggregate
// queries — cheap enough for Cloudflare's free plan.

import type { Env } from '../lib/env';
import { ORDERABLE_SQL, translationCoverage, UNCONFIRMED_SQL } from './catalog';
import { all, now, one } from './db';
import { setupStatus } from './status';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Monday 00:00 UTC of the week containing ms. */
const weekStart = (ms: number) => {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
};
const monthStart = (ms: number, back = 0) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1); };

export interface QueueItem { kind: 'partner' | 'order' | 'proposal' | 'prices'; id: number; title: string; detail: string; amount?: number; at: number }
export interface FeedItem { id: number; at: number; actor_type: string; actor_label: string; action: string; target: string; detail: Record<string, unknown> }

export async function dashboardData(env: Env, baseUrl: string) {
  const t = now();
  const w0 = weekStart(t) - 11 * WEEK;
  const [m0, m1] = [monthStart(t), monthStart(t, 1)];

  const [weeksRaw, month, prev, inv, queuePartners, queueOrders, queueProposals, top, recent, feedRaw, catalog, cov, setup, partners] = await Promise.all([
    all<{ w: number; net: number; n: number }>(env.DB,
      "SELECT CAST((confirmed_at - ?1) / ?2 AS INTEGER) AS w, SUM(subtotal_net_rappen) AS net, COUNT(*) AS n FROM orders WHERE state = 'confirmed' AND confirmed_at >= ?1 GROUP BY w", w0, WEEK),
    one<{ net: number; n: number }>(env.DB, "SELECT COALESCE(SUM(subtotal_net_rappen), 0) AS net, COUNT(*) AS n FROM orders WHERE state = 'confirmed' AND confirmed_at >= ?", m0),
    // Same stretch of last month (1st → today's day-of-month), so the comparison is fair mid-month.
    one<{ net: number; n: number }>(env.DB, "SELECT COALESCE(SUM(subtotal_net_rappen), 0) AS net, COUNT(*) AS n FROM orders WHERE state = 'confirmed' AND confirmed_at >= ? AND confirmed_at < ?", m1, m1 + (t - m0)),
    one<{ paid_n: number; paid: number; open_n: number; open: number; overdue_n: number; overdue: number }>(env.DB,
      `SELECT SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_n, COALESCE(SUM(CASE WHEN status = 'paid' THEN total_rappen END), 0) AS paid,
              SUM(CASE WHEN status = 'open' AND due_date >= date('now') THEN 1 ELSE 0 END) AS open_n, COALESCE(SUM(CASE WHEN status = 'open' AND due_date >= date('now') THEN total_rappen END), 0) AS open,
              SUM(CASE WHEN status = 'open' AND due_date < date('now') THEN 1 ELSE 0 END) AS overdue_n, COALESCE(SUM(CASE WHEN status = 'open' AND due_date < date('now') THEN total_rappen END), 0) AS overdue
       FROM invoices WHERE kind = 'invoice'`),
    all<{ id: number; company: string; city: string; created_at: number }>(env.DB, "SELECT id, company, city, created_at FROM partners WHERE status = 'pending' ORDER BY id DESC LIMIT 8"),
    all<{ id: number; ref: string; company: string; subtotal_net_rappen: number; created_at: number }>(env.DB,
      "SELECT o.id, o.ref, p.company, o.subtotal_net_rappen, o.created_at FROM orders o JOIN partners p ON p.id = o.partner_id WHERE o.state = 'awaiting_approval' ORDER BY o.id DESC LIMIT 8"),
    all<{ id: number; kind: string; reason: string; proposed_by: string; created_at: number }>(env.DB, "SELECT id, kind, reason, proposed_by, created_at FROM proposals WHERE status = 'open' ORDER BY id DESC LIMIT 8"),
    all<{ company: string; net: number; n: number }>(env.DB,
      "SELECT p.company, SUM(o.subtotal_net_rappen) AS net, COUNT(*) AS n FROM orders o JOIN partners p ON p.id = o.partner_id WHERE o.state = 'confirmed' AND o.confirmed_at >= ? GROUP BY p.id ORDER BY net DESC LIMIT 5", t - 90 * DAY),
    all<{ ref: string; state: string; total_rappen: number; created_at: number; company: string; city: string }>(env.DB,
      'SELECT o.ref, o.state, o.total_rappen, o.created_at, p.company, p.city FROM orders o JOIN partners p ON p.id = o.partner_id ORDER BY o.created_at DESC LIMIT 7'),
    all<{ id: number; at: number; actor_type: string; actor_label: string; action: string; target: string; detail: string }>(env.DB,
      "SELECT id, at, actor_type, actor_label, action, target, detail FROM audit_log WHERE action NOT IN ('agent_token.create', 'agent_token.revoke', 'partner.signin_link') ORDER BY at DESC, id DESC LIMIT 12"),
    one<{ orderable: number; flagged: number; unconfirmed: number }>(env.DB, `SELECT SUM(CASE WHEN ${ORDERABLE_SQL} THEN 1 ELSE 0 END) AS orderable, SUM(unpriceable) AS flagged, SUM(CASE WHEN ${UNCONFIRMED_SQL} THEN 1 ELSE 0 END) AS unconfirmed FROM products`),
    translationCoverage(env.DB),
    setupStatus(env, baseUrl),
    one<{ approved: number; pending: number }>(env.DB, "SELECT SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending FROM partners"),
  ]);

  const weeks = Array.from({ length: 12 }, (_, i) => {
    const r = weeksRaw.find((x) => x.w === i);
    return { start: w0 + i * WEEK, net: r?.net ?? 0, n: r?.n ?? 0 };
  });
  const queue: QueueItem[] = [
    ...queueOrders.map((o) => ({ kind: 'order' as const, id: o.id, title: `${o.ref} · ${o.company}`, detail: '', amount: o.subtotal_net_rappen, at: o.created_at })),
    ...queuePartners.map((p) => ({ kind: 'partner' as const, id: p.id, title: p.company, detail: p.city, at: p.created_at })),
    ...queueProposals.map((p) => ({ kind: 'proposal' as const, id: p.id, title: p.reason || p.kind.replace('_', ' '), detail: p.proposed_by.replace(/^agent:/, ''), at: p.created_at })),
  ].sort((a, b) => b.at - a.at);
  // Prices the agent found on the merchant's website wait as one entry (they're confirmed in one go).
  if (catalog?.unconfirmed) queue.unshift({ kind: 'prices', id: 0, title: String(catalog.unconfirmed), detail: '', at: t });
  const feed: FeedItem[] = feedRaw.map((f) => ({ ...f, detail: safeJson(f.detail) }));
  const stepsDone = setup.steps.filter((s) => s.done).length;

  return {
    now: t,
    month: { net: month?.net ?? 0, n: month?.n ?? 0, prevNet: prev?.net ?? 0, prevN: prev?.n ?? 0 },
    weeks,
    invoices: { paid_n: inv?.paid_n ?? 0, paid: inv?.paid ?? 0, open_n: inv?.open_n ?? 0, open: inv?.open ?? 0, overdue_n: inv?.overdue_n ?? 0, overdue: inv?.overdue ?? 0 },
    queue,
    top,
    recent,
    feed,
    catalog: { orderable: catalog?.orderable ?? 0, flagged: catalog?.flagged ?? 0, coverage: cov },
    partners: { approved: partners?.approved ?? 0, pending: partners?.pending ?? 0 },
    setup: { done: stepsDone, total: setup.steps.length, complete: stepsDone === setup.steps.length, next: setup.next_action },
  };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

/** Count for the Approvals badge in the console navigation. */
export async function approvalsCount(db: D1Database): Promise<number> {
  const r = await one<{ n: number }>(db,
    `SELECT (SELECT COUNT(*) FROM partners WHERE status = 'pending') + (SELECT COUNT(*) FROM orders WHERE state = 'awaiting_approval') + (SELECT COUNT(*) FROM proposals WHERE status = 'open')
          + (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM products WHERE ${UNCONFIRMED_SQL}) AS n`);
  return r?.n ?? 0;
}

function safeJson(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
