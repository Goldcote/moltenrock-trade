// QR-bill invoices and credit notes (decision 12): gapless numbering per series, PDF archived with its
// SHA-256, corrections only by credit note. Invoices are issued when an order is confirmed.

import { renderInvoicePdf, type InvoicePdfInput } from '../invoice/pdf';
import { isLang } from '../i18n';
import type { Actor, Env } from '../lib/env';
import { sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/http';
import { addDaysISO, isoDate } from '../money/format';
import type { Totals } from '../money/pricing';
import { buildQrPayload, buildS1 } from '../swiss/qrbill';
import { isQrIban, makeQrr, makeScor } from '../swiss/validate';
import { all, audit, now, one, run } from './db';
import { getPartner } from './partners';
import { getSettings, requireShop } from './settings';

export interface InvoiceRow {
  id: number; kind: 'invoice' | 'credit_note'; number: number; order_id: number; related_invoice_id: number | null; partner_id: number;
  issue_date: string; due_date: string | null; language: string; currency: string; net_rappen: number; vat_rappen: number; total_rappen: number;
  vat_breakdown: string; reference: string; status: 'open' | 'paid' | 'credited' | 'issued'; paid_at: number | null; created_at: number;
}

const COLS = 'id, kind, number, order_id, related_invoice_id, partner_id, issue_date, due_date, language, currency, net_rappen, vat_rappen, total_rappen, vat_breakdown, reference, status, paid_at, created_at';
export const displayNumber = (inv: Pick<InvoiceRow, 'kind' | 'number'>) => `${inv.kind === 'credit_note' ? 'GS-' : ''}${String(inv.number).padStart(6, '0')}`;

export const getInvoice = (db: D1Database, id: number) => one<InvoiceRow>(db, `SELECT ${COLS} FROM invoices WHERE id = ?`, id);

export function listInvoices(db: D1Database, f: { partnerId?: number; status?: string; orderId?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.partnerId) { where.push('partner_id = ?'); params.push(f.partnerId); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.orderId) { where.push('order_id = ?'); params.push(f.orderId); }
  return all<InvoiceRow>(db, `SELECT ${COLS} FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`, ...params);
}

interface OrderSnap { ref: string; po_number: string; created_at: number; language: string; pricing_snapshot: string }

/** Issue the invoice for a confirmed order (idempotent: one invoice per order). */
export async function issueInvoice(env: Env, orderId: number): Promise<InvoiceRow> {
  const existing = await one<InvoiceRow>(env.DB, `SELECT ${COLS} FROM invoices WHERE order_id = ? AND kind = 'invoice'`, orderId);
  if (existing) return existing;
  const order = await one<OrderSnap & { partner_id: number; subtotal_net_rappen: number; vat_rappen: number; total_rappen: number; currency: string }>(env.DB,
    'SELECT ref, po_number, created_at, language, pricing_snapshot, partner_id, subtotal_net_rappen, vat_rappen, total_rappen, currency FROM orders WHERE id = ?', orderId);
  if (!order) throw new AppError('NOT_FOUND', `Order ${orderId} not found`, 404);
  const [partner, settings, shop] = [await getPartner(env.DB, order.partner_id), await getSettings(env.DB), await requireShop(env.DB)];
  if (!partner) throw new AppError('NOT_FOUND', 'Partner not found', 404);
  const snap = JSON.parse(order.pricing_snapshot) as { totals: Totals };
  const issue = isoDate(now());
  const terms = partner.prepayment ? 0 : partner.payment_terms_days ?? settings.payment_terms_days;
  // Gapless: the counter increment and the insert run in ONE batch (a single transaction).
  await env.DB.batch([
    env.DB.prepare("UPDATE counters SET value = value + 1 WHERE name = 'invoice'"),
    env.DB.prepare(`INSERT INTO invoices (kind, number, order_id, partner_id, issue_date, due_date, language, currency, net_rappen, vat_rappen, total_rappen, vat_breakdown, status, created_at)
      VALUES ('invoice', (SELECT value FROM counters WHERE name = 'invoice'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
      .bind(orderId, partner.id, issue, addDaysISO(issue, terms), order.language, order.currency, order.subtotal_net_rappen, order.vat_rappen, order.total_rappen,
        JSON.stringify(snap.totals.breakdown), now()),
  ]);
  const inv = (await one<InvoiceRow>(env.DB, `SELECT ${COLS} FROM invoices WHERE order_id = ? AND kind = 'invoice'`, orderId)) as InvoiceRow;
  const body = String(inv.number).padStart(10, '0');
  const reference = shop.iban && isQrIban(shop.iban) ? makeQrr(body) : makeScor(body);
  await run(env.DB, 'UPDATE invoices SET reference = ? WHERE id = ?', reference, inv.id);
  // The PDF is rendered on first download only: rendering costs ~25–35 ms CPU, more than the free
  // plan's 10 ms, and must never make confirming an order fail. The HTML invoice works on every plan.
  return { ...inv, reference };
}

/** Everything needed to show an invoice (used by both the HTML page and the PDF). */
export async function invoiceDocument(env: Env, inv: InvoiceRow): Promise<InvoicePdfInput> {
  const shop = await requireShop(env.DB);
  const partner = await getPartner(env.DB, inv.partner_id);
  const order = await one<OrderSnap & { id: number }>(env.DB, 'SELECT id, ref, po_number, created_at, language, pricing_snapshot FROM orders WHERE id = ?', inv.order_id);
  if (!partner || !order) throw new AppError('NOT_FOUND', 'Invoice data missing', 404);
  const lines = await all<{ qty: number; name: string; sku: string; unit_net_rappen: number; line_net_rappen: number }>(env.DB,
    'SELECT qty, name, sku, unit_net_rappen, line_net_rappen FROM order_lines WHERE order_id = ? ORDER BY line_no', inv.order_id);
  const sign = inv.kind === 'credit_note' ? -1 : 1;
  const breakdown = JSON.parse(inv.vat_breakdown) as Totals['breakdown'];
  const totals: Totals = { subtotalNetRappen: sign * inv.net_rappen, vatRappen: sign * inv.vat_rappen, totalRappen: sign * inv.total_rappen,
    breakdown: breakdown.map((b) => ({ ...b, netRappen: sign * b.netRappen, vatRappen: sign * b.vatRappen })) };
  const lang = isLang(inv.language) ? inv.language : 'de';
  const shopAddr = { name: shop.legal_name, street: shop.street, houseNo: shop.house_no, postcode: shop.postcode, city: shop.city, country: shop.country };
  const partnerAddr = { name: partner.company, street: partner.street, houseNo: partner.house_no, postcode: partner.postcode, city: partner.city, country: partner.country };
  const number = displayNumber(inv);
  const related = inv.related_invoice_id ? await getInvoice(env.DB, inv.related_invoice_id) : null;

  let qr: InvoicePdfInput['qr'] = null;
  if (inv.kind === 'invoice' && shop.iban) {
    const reference = inv.reference.startsWith('RF') ? { type: 'SCOR' as const, value: inv.reference } : { type: 'QRR' as const, value: inv.reference };
    const billingInfo = buildS1({
      invoiceNo: number, invoiceDate: inv.issue_date, customerRef: order.po_number || undefined,
      uid: shop.vat_registered && shop.uid ? shop.uid : undefined, serviceDate: inv.issue_date,
      vat: shop.vat_registered ? breakdown.map((b) => ({ rateBp: b.rateBp, netRappen: b.netRappen })) : undefined,
      termsDays: inv.due_date ? Math.round((Date.parse(inv.due_date) - Date.parse(inv.issue_date)) / 86_400_000) : undefined,
    });
    const message = order.ref;
    const payload = buildQrPayload({ iban: shop.iban, creditor: shopAddr, debtor: partnerAddr, amountRappen: inv.total_rappen, currency: 'CHF', reference, message, billingInfo });
    qr = { payload, iban: shop.iban, reference, message, billingInfo, amountRappen: inv.total_rappen };
  }
  const termsDays = inv.due_date ? Math.round((Date.parse(inv.due_date) - Date.parse(inv.issue_date)) / 86_400_000) : null;
  return {
    kind: inv.kind, number, lang, issueDate: inv.issue_date, serviceDate: inv.issue_date, dueDate: inv.kind === 'invoice' ? inv.due_date : null,
    orderRef: order.ref, poNumber: order.po_number, termsDays: termsDays || null, relatesToNumber: related ? displayNumber(related) : undefined,
    shop: { ...shopAddr, email: shop.email, uid: shop.uid, vatRegistered: !!shop.vat_registered },
    partner: { ...partnerAddr, contact: partner.contact_name },
    lines: lines.map((l) => ({ ...l, unitNetRappen: sign * l.unit_net_rappen, lineNetRappen: sign * l.line_net_rappen })),
    totals, currency: inv.currency, qr,
  };
}

/** PDF bytes; rendered once and archived with its hash (re-rendered only if missing). */
export async function invoicePdf(env: Env, id: number): Promise<Uint8Array> {
  const row = await one<{ pdf: ArrayBuffer | number[] | null }>(env.DB, 'SELECT pdf FROM invoices WHERE id = ?', id);
  if (row?.pdf) return row.pdf instanceof ArrayBuffer ? new Uint8Array(row.pdf) : Uint8Array.from(row.pdf);
  const inv = await getInvoice(env.DB, id);
  if (!inv) throw new AppError('NOT_FOUND', `Invoice ${id} not found`, 404);
  const bytes = await renderInvoicePdf(await invoiceDocument(env, inv));
  await run(env.DB, 'UPDATE invoices SET pdf = ?, pdf_sha256 = ? WHERE id = ?', bytes, await sha256Hex(bytes), id);
  return bytes;
}

/** Full credit note for an invoice (own gapless series). Humans only; agents propose it. */
export async function creditNote(env: Env, actor: Actor, invoiceId: number, reason: string): Promise<InvoiceRow> {
  if (actor.type !== 'user') throw new AppError('HUMAN_ONLY', 'Credit notes need a person. Agents: use propose_credit_note.', 403);
  const inv = await getInvoice(env.DB, invoiceId);
  if (!inv || inv.kind !== 'invoice') throw new AppError('NOT_FOUND', `Invoice ${invoiceId} not found`, 404);
  if (inv.status === 'credited') throw new AppError('ALREADY_CREDITED', 'This invoice already has a credit note.', 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE counters SET value = value + 1 WHERE name = 'credit_note'"),
    env.DB.prepare(`INSERT INTO invoices (kind, number, order_id, related_invoice_id, partner_id, issue_date, due_date, language, currency, net_rappen, vat_rappen, total_rappen, vat_breakdown, status, created_at)
      VALUES ('credit_note', (SELECT value FROM counters WHERE name = 'credit_note'), ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'issued', ?)`)
      .bind(inv.order_id, inv.id, inv.partner_id, isoDate(now()), inv.language, inv.currency, inv.net_rappen, inv.vat_rappen, inv.total_rappen, inv.vat_breakdown, now()),
    env.DB.prepare("UPDATE invoices SET status = 'credited' WHERE id = ?").bind(inv.id),
  ]);
  const cn = (await one<InvoiceRow>(env.DB, `SELECT ${COLS} FROM invoices WHERE related_invoice_id = ? AND kind = 'credit_note' ORDER BY id DESC LIMIT 1`, inv.id)) as InvoiceRow;
  await audit(env.DB, actor, 'invoice.credit_note', `invoice:${inv.id}`, { credit_note: displayNumber(cn), reason });
  return cn;
}

export async function markPaid(env: Env, actor: Actor, invoiceId: number, paidOn?: string): Promise<InvoiceRow> {
  const inv = await getInvoice(env.DB, invoiceId);
  if (!inv || inv.kind !== 'invoice') throw new AppError('NOT_FOUND', `Invoice ${invoiceId} not found`, 404);
  if (inv.status !== 'open') throw new AppError('NOT_OPEN', `Invoice is ${inv.status}, not open.`, 409);
  const at = paidOn && /^\d{4}-\d{2}-\d{2}$/.test(paidOn) ? Date.parse(paidOn + 'T12:00:00Z') : now();
  await run(env.DB, "UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'open'", at, invoiceId);
  await audit(env.DB, actor, 'invoice.mark_paid', `invoice:${invoiceId}`, { paid_on: isoDate(at) });
  return (await getInvoice(env.DB, invoiceId)) as InvoiceRow;
}
