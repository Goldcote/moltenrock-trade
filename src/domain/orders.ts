// Order lifecycle:
//   placed ──(net > threshold)──▶ awaiting_approval ──human approves──▶ confirmed ─▶ invoice issued
//     │                                    └──human rejects──▶ rejected
//     └─(otherwise)──▶ cancel_window (partner may cancel for N minutes) ──▶ confirmed ─▶ invoice issued
// Partners can cancel while awaiting approval or inside the cancel window.

import { t, type Lang } from '../i18n';
import type { Actor, Env } from '../lib/env';
import { orderRef } from '../lib/crypto';
import { AppError } from '../lib/http';
import { formatMoney } from '../money/format';
import { needsApproval } from '../money/pricing';
import { recordHandoff } from '../integrations';
import { cartItems, priceItems, setCartQty } from './cart';
import { all, audit, now, one, run, sendEmail } from './db';
import { displayNumber, issueInvoice } from './invoices';
import { getPartner, type Partner } from './partners';
import { getSettings, requireShop, type Settings, type Shop } from './settings';

export type OrderState = 'awaiting_approval' | 'cancel_window' | 'confirmed' | 'cancelled' | 'rejected';
export interface OrderRow {
  id: number; ref: string; partner_id: number; placed_by: number; state: OrderState; po_number: string; ship_mode: 'delivery' | 'pickup';
  ship_to: string; note: string; language: Lang; currency: string; subtotal_net_rappen: number; vat_rappen: number; total_rappen: number;
  pricing_snapshot: string; created_at: number; approved_at: number | null; approved_by: string | null; confirm_after: number | null;
  confirmed_at: number | null; cancelled_at: number | null; decided_reason: string;
}
export interface OrderLine { line_no: number; product_id: number; source_id: string; sku: string; name: string; qty: number; unit_net_rappen: number; line_net_rappen: number; vat_code: string; vat_rate_bp: number }

export async function placeOrder(env: Env, actor: Actor & { type: 'partner' }, ctx: { shop: Shop; settings: Settings; partner: Partner; lang: Lang }, input: { po_number?: string; ship_mode?: string; note?: string }, baseUrl: string): Promise<OrderRow> {
  const { partner, settings, shop } = ctx;
  if (partner.status !== 'approved') throw new AppError('NOT_APPROVED', 'Your trade account is not active.', 403);
  const items = await cartItems(env.DB, partner.id);
  if (!items.length) throw new AppError('EMPTY_CART', 'The cart is empty.');
  const priced = await priceItems(env.DB, ctx, items);
  if (priced.problems.length) throw new AppError('NOT_ORDERABLE', 'Some items can no longer be ordered.', 409, { problems: priced.problems });
  if (priced.missing_rappen > 0) throw new AppError('MIN_ORDER', 'The minimum order value has not been reached.', 409, { missing_rappen: priced.missing_rappen });

  const held = needsApproval(priced.totals.subtotalNetRappen, settings.approval_threshold_rappen, !!partner.trusted);
  const ts = now();
  const shipMode = input.ship_mode === 'pickup' ? 'pickup' : 'delivery';
  const shipTo = { company: partner.company, contact: partner.contact_name, street: partner.street, house_no: partner.house_no, postcode: partner.postcode, city: partner.city, country: partner.country };
  const snapshot = { at: ts, tier: priced.tier_name, discount_bp: priced.discount_bp, vat_registered: !!shop.vat_registered, lines: priced.lines, totals: priced.totals };

  let ref = orderRef();
  for (let i = 0; i < 3 && (await one(env.DB, 'SELECT 1 FROM orders WHERE ref = ?', ref)); i++) ref = orderRef();
  const res = await run(env.DB, `INSERT INTO orders (ref, partner_id, placed_by, state, po_number, ship_mode, ship_to, note, language, currency, subtotal_net_rappen, vat_rappen, total_rappen, pricing_snapshot, created_at, confirm_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ref, partner.id, actor.id, held ? 'awaiting_approval' : 'cancel_window', (input.po_number ?? '').trim().slice(0, 35), shipMode, JSON.stringify(shipTo),
    (input.note ?? '').trim().slice(0, 500), ctx.lang, shop.currency, priced.totals.subtotalNetRappen, priced.totals.vatRappen, priced.totals.totalRappen,
    JSON.stringify(snapshot), ts, held ? null : ts + settings.cancel_window_minutes * 60_000);
  const orderId = Number(res.meta.last_row_id);
  await env.DB.batch([
    ...priced.lines.map((l, i) => env.DB.prepare(`INSERT INTO order_lines (order_id, line_no, product_id, source_id, sku, name, qty, unit_net_rappen, line_net_rappen, vat_code, vat_rate_bp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(orderId, i + 1, l.product_id, l.source_id, l.sku, l.name, l.qty, l.unit_net_rappen, l.line_net_rappen, l.vat_code, l.vat_rate_bp)),
    env.DB.prepare('DELETE FROM cart_items WHERE partner_id = ?').bind(partner.id),
  ]);
  await audit(env.DB, actor, 'order.place', `order:${ref}`, { total_rappen: priced.totals.totalRappen, held });

  const total = formatMoney(priced.totals.totalRappen, ctx.lang, shop.currency);
  const link = `${baseUrl}/orders/${ref}`;
  if (held) await sendEmail(env, partner.email, t(ctx.lang, 'email.orderHeld.subject', { ref }), t(ctx.lang, 'email.orderHeld.body', { ref, total, shop: shop.legal_name }));
  else await sendEmail(env, partner.email, t(ctx.lang, 'email.orderReceived.subject', { ref }), t(ctx.lang, 'email.orderReceived.body', { ref, total, minutes: settings.cancel_window_minutes, link }));
  await sendEmail(env, shop.email, `${held ? 'Approval needed' : 'New trade order'}: ${ref} from ${partner.company} (${total})`,
    `${partner.company} placed ${ref} for ${total}.${held ? ' It is above your approval amount: confirm it under Approvals.' : ''}`);
  return (await getOrder(env.DB, orderId)) as OrderRow;
}

/** Confirm, invoice and hand off. Safe to call twice: the state guard makes it happen once. */
async function confirmOrder(env: Env, orderId: number, actor: Actor, baseUrl: string): Promise<void> {
  const res = await run(env.DB, "UPDATE orders SET state = 'confirmed', confirmed_at = ? WHERE id = ? AND state IN ('cancel_window', 'awaiting_approval')", now(), orderId);
  if (res.meta.changes !== 1) return;
  const order = (await getOrder(env.DB, orderId)) as OrderRow;
  const [partner, shop, settings] = [await getPartner(env.DB, order.partner_id), await requireShop(env.DB), await getSettings(env.DB)];
  if (!partner) return;
  const inv = await issueInvoice(env, orderId);
  const lines = await orderLines(env.DB, orderId);
  const parents = new Map((await all<{ source_id: string; parent_source_id: string | null }>(env.DB,
    `SELECT source_id, parent_source_id FROM products WHERE id IN (${lines.map(() => '?').join(',') || 'NULL'})`, ...lines.map((l) => l.product_id))).map((r) => [r.source_id, r.parent_source_id]));
  await recordHandoff(env, settings, orderId, {
    ref: order.ref, po_number: order.po_number, ship_mode: order.ship_mode, note: order.note, ship_to: JSON.parse(order.ship_to),
    lines: lines.map((l) => ({ source_id: l.source_id, parent_source_id: parents.get(l.source_id) ?? null, sku: l.sku, qty: l.qty, line_net_rappen: l.line_net_rappen })),
  }, partner, shop);
  await audit(env.DB, actor, 'order.confirm', `order:${order.ref}`, { invoice: displayNumber(inv) });
  await sendEmail(env, partner.email, t(order.language, 'email.orderConfirmed.subject', { ref: order.ref, number: displayNumber(inv) }),
    t(order.language, 'email.orderConfirmed.body', { ref: order.ref, number: displayNumber(inv), link: `${baseUrl}/orders/${order.ref}` }));
}

/** Confirm every order whose cancel window has passed (called on requests and by the cron trigger). */
export async function finalizeDueOrders(env: Env, baseUrl: string): Promise<number> {
  const due = await all<{ id: number }>(env.DB, "SELECT id FROM orders WHERE state = 'cancel_window' AND confirm_after <= ? ORDER BY id LIMIT 25", now());
  for (const o of due) await confirmOrder(env, o.id, { type: 'system', label: 'cancel-window' }, baseUrl);
  return due.length;
}

export async function cancelOrder(env: Env, actor: Actor & { type: 'partner' }, orderId: number): Promise<OrderRow> {
  const o = await getOrder(env.DB, orderId);
  if (!o || o.partner_id !== actor.partnerId) throw new AppError('NOT_FOUND', 'Order not found', 404);
  const open = o.state === 'awaiting_approval' || (o.state === 'cancel_window' && (o.confirm_after ?? 0) > now());
  if (!open) throw new AppError('TOO_LATE', 'This order can no longer be cancelled.', 409);
  await run(env.DB, "UPDATE orders SET state = 'cancelled', cancelled_at = ? WHERE id = ? AND state IN ('awaiting_approval', 'cancel_window')", now(), orderId);
  await audit(env.DB, actor, 'order.cancel', `order:${o.ref}`);
  return (await getOrder(env.DB, orderId)) as OrderRow;
}

/** Approve or reject a held basket. Humans only — agents file a proposal. */
export async function decideHeldOrder(env: Env, actor: Actor, orderId: number, decision: 'approve' | 'reject', reason: string, baseUrl: string): Promise<OrderRow> {
  if (actor.type !== 'user') throw new AppError('HUMAN_ONLY', 'Approving held orders needs a person. Agents: use propose_basket_decision.', 403);
  const o = await getOrder(env.DB, orderId);
  if (!o) throw new AppError('NOT_FOUND', 'Order not found', 404);
  if (o.state !== 'awaiting_approval') throw new AppError('NOT_HELD', `Order is ${o.state}, not awaiting approval.`, 409);
  if (decision === 'approve') {
    await run(env.DB, 'UPDATE orders SET approved_at = ?, approved_by = ?, decided_reason = ? WHERE id = ?', now(), actor.label, reason, orderId);
    await confirmOrder(env, orderId, actor, baseUrl);
  } else {
    await run(env.DB, "UPDATE orders SET state = 'rejected', approved_by = ?, decided_reason = ? WHERE id = ? AND state = 'awaiting_approval'", actor.label, reason, orderId);
    const partner = await getPartner(env.DB, o.partner_id);
    const shop = await requireShop(env.DB);
    if (partner) await sendEmail(env, partner.email, t(o.language, 'email.orderRejected.subject', { ref: o.ref }), t(o.language, 'email.orderRejected.body', { ref: o.ref, shop: shop.legal_name }));
    await audit(env.DB, actor, 'order.reject', `order:${o.ref}`, { reason });
  }
  return (await getOrder(env.DB, orderId)) as OrderRow;
}

export async function reorder(db: D1Database, partnerId: number, orderId: number, settings: Settings): Promise<{ added: number; skipped: number }> {
  const o = await getOrder(db, orderId);
  if (!o || o.partner_id !== partnerId) throw new AppError('NOT_FOUND', 'Order not found', 404);
  let added = 0, skipped = 0;
  for (const l of await orderLines(db, orderId)) {
    try { await setCartQty(db, partnerId, l.product_id, l.qty, settings); added++; } catch { skipped++; }
  }
  return { added, skipped };
}

export const getOrder = (db: D1Database, id: number) => one<OrderRow>(db, 'SELECT * FROM orders WHERE id = ?', id);
export const getOrderByRef = (db: D1Database, ref: string) => one<OrderRow>(db, 'SELECT * FROM orders WHERE ref = ?', ref);
export const orderLines = (db: D1Database, orderId: number) => all<OrderLine>(db, 'SELECT * FROM order_lines WHERE order_id = ? ORDER BY line_no', orderId);

export function listOrders(db: D1Database, f: { partnerId?: number; state?: string; limit?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.partnerId) { where.push('o.partner_id = ?'); params.push(f.partnerId); }
  if (f.state) { where.push('o.state = ?'); params.push(f.state); }
  return all<OrderRow & { company: string }>(db,
    `SELECT o.*, p.company FROM orders o JOIN partners p ON p.id = o.partner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ?`,
    ...params, Math.min(f.limit ?? 100, 500));
}
