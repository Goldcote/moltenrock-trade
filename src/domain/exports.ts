// Accounting and backup exports. Swiss bookkeeping needs invoices, credit notes and payments in a
// form an accountant (or Bexio / Banana / Abacus) can import, and records must be kept for 10 years
// (art. 958f CO) — so the merchant can take everything out at any time, per period or complete.
//
// CSV conventions (what Swiss Excel opens correctly): UTF-8 with BOM, ";" separators, CRLF line ends,
// amounts as plain decimals ("1234.50"), dates as YYYY-MM-DD. Text cells that start with = + - @
// (or a tab / carriage return) are prefixed with ' so a spreadsheet never runs them as formulas.

import type { Env } from '../lib/env';
import { AppError } from '../lib/http';
import { VERSION } from '../version';
import { all } from './db';
import { displayNumber } from './invoices';
import type { Settings } from './settings';

export const EXPORT_FILES = ['invoices', 'invoice-lines', 'customers', 'journal', 'backup'] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];
/** Files an agent may hand out as a signed link. The complete backup is for the owner only. */
export const AGENT_EXPORT_FILES: ExportFile[] = ['invoices', 'invoice-lines', 'customers', 'journal'];

export interface Period { label: string; from: string; to: string } // ISO dates, `to` exclusive

/** "2026", "2026-09", "2026-Q3", or "all". */
export function parsePeriod(input: string | null | undefined, today = new Date()): Period {
  const v = (input ?? '').trim() || String(today.getUTCFullYear());
  if (v === 'all') return { label: 'all', from: '0000-01-01', to: '9999-12-31' };
  let m = /^(\d{4})$/.exec(v);
  if (m) return { label: v, from: `${m[1]}-01-01`, to: `${Number(m[1]) + 1}-01-01` };
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]);
    return { label: v, from: `${m[1]}-${m[2]}-01`, to: mo === 12 ? `${y + 1}-01-01` : `${m[1]}-${String(mo + 1).padStart(2, '0')}-01` };
  }
  m = /^(\d{4})-Q([1-4])$/i.exec(v);
  if (m) {
    const y = Number(m[1]), q = Number(m[2]);
    const start = (q - 1) * 3 + 1;
    return { label: `${m[1]}-Q${q}`, from: `${m[1]}-${String(start).padStart(2, '0')}-01`, to: q === 4 ? `${y + 1}-01-01` : `${m[1]}-${String(start + 3).padStart(2, '0')}-01` };
  }
  throw new AppError('INVALID_PERIOD', 'Period must be a year (2026), a month (2026-09), a quarter (2026-Q3) or "all".');
}

type Cell = string | number | null | undefined | { num: number };

const amount = (rappen: number) => ({ num: rappen });

function cell(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') return (c.num / 100).toFixed(2);
  let s = typeof c === 'number' ? String(c) : c;
  if (typeof c === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const VAT_RATES = [810, 380, 260, 0];
const displayNo = (kind: string, n: number) => displayNumber({ kind: kind === 'credit_note' ? 'credit_note' : 'invoice', number: n });

interface InvoiceExportRow {
  id: number; kind: string; number: number; issue_date: string; due_date: string | null; status: string; paid_at: number | null;
  net_rappen: number; vat_rappen: number; total_rappen: number; vat_breakdown: string; reference: string; currency: string; language: string;
  related_number: number | null; order_ref: string; po_number: string;
  company: string; uid: string | null; street: string; house_no: string; postcode: string; city: string; country: string; email: string;
}

const invoiceRows = (env: Env, p: Period) => all<InvoiceExportRow>(env.DB,
  `SELECT i.id, i.kind, i.number, i.issue_date, i.due_date, i.status, i.paid_at, i.net_rappen, i.vat_rappen, i.total_rappen, i.vat_breakdown,
          i.reference, i.currency, i.language, r.number AS related_number, o.ref AS order_ref, o.po_number,
          p.company, p.uid, p.street, p.house_no, p.postcode, p.city, p.country, p.email
   FROM invoices i JOIN orders o ON o.id = i.order_id JOIN partners p ON p.id = i.partner_id LEFT JOIN invoices r ON r.id = i.related_invoice_id
   WHERE i.issue_date >= ? AND i.issue_date < ? ORDER BY i.issue_date, i.kind, i.number`, p.from, p.to);

/** One row per invoice / credit note; credit notes carry negative amounts. */
export async function invoicesCsv(env: Env, p: Period): Promise<string> {
  const rows = await invoiceRows(env, p);
  const header: Cell[] = ['document', 'type', 'issue_date', 'due_date', 'status', 'paid_on', 'customer', 'customer_uid', 'street', 'postcode', 'city', 'country', 'email',
    'order', 'po_number', 'relates_to', 'currency',
    ...VAT_RATES.flatMap((r) => [`net_${r / 100}`, ...(r ? [`vat_${r / 100}`] : [])]), 'net_total', 'vat_total', 'total', 'qr_reference', 'language'];
  return toCsv([header, ...rows.map((i) => {
    const sign = i.kind === 'credit_note' ? -1 : 1;
    const br = safeBreakdown(i.vat_breakdown);
    const per = (rate: number) => br.find((b) => b.rateBp === rate);
    return [
      displayNo(i.kind, i.number), i.kind === 'credit_note' ? 'credit note' : 'invoice', i.issue_date, i.due_date ?? '', i.status, iso(i.paid_at),
      i.company, i.uid ?? '', `${i.street} ${i.house_no}`.trim(), i.postcode, i.city, i.country, i.email,
      i.order_ref, i.po_number, i.related_number ? displayNo('invoice', i.related_number) : '', i.currency,
      ...VAT_RATES.flatMap((r) => {
        const b = per(r);
        // A shop that is not VAT-registered has no breakdown: everything is net at 0 %.
        const net = b ? b.netRappen : r === 0 && !br.length ? i.net_rappen : 0;
        return [amount(sign * net), ...(r ? [amount(sign * (b?.vatRappen ?? 0))] : [])];
      }),
      amount(sign * i.net_rappen), amount(sign * i.vat_rappen), amount(sign * i.total_rappen), i.reference, i.language,
    ];
  })]);
}

/** One row per invoice line (what was sold, for stock and revenue analysis). */
export async function invoiceLinesCsv(env: Env, p: Period): Promise<string> {
  const rows = await all<{ kind: string; number: number; issue_date: string; company: string; order_ref: string; line_no: number; sku: string; name: string; qty: number; unit_net_rappen: number; line_net_rappen: number; vat_rate_bp: number }>(env.DB,
    `SELECT i.kind, i.number, i.issue_date, p.company, o.ref AS order_ref, l.line_no, l.sku, l.name, l.qty, l.unit_net_rappen, l.line_net_rappen, l.vat_rate_bp
     FROM invoices i JOIN orders o ON o.id = i.order_id JOIN partners p ON p.id = i.partner_id JOIN order_lines l ON l.order_id = i.order_id
     WHERE i.kind = 'invoice' AND i.issue_date >= ? AND i.issue_date < ? ORDER BY i.issue_date, i.number, l.line_no`, p.from, p.to);
  return toCsv([['document', 'issue_date', 'customer', 'order', 'line', 'sku', 'item', 'qty', 'unit_net', 'line_net', 'vat_rate'],
    ...rows.map((r) => [displayNo(r.kind, r.number), r.issue_date, r.company, r.order_ref, r.line_no, r.sku, r.name, r.qty, amount(r.unit_net_rappen), amount(r.line_net_rappen), (r.vat_rate_bp / 100).toFixed(1)])]);
}

/** Trade customers with their terms (for the accountant's debtor list or a CRM). */
export async function customersCsv(env: Env): Promise<string> {
  const rows = await all<{ id: number; company: string; contact_name: string; email: string; phone: string; street: string; house_no: string; postcode: string; city: string; country: string; uid: string | null; language: string; business_type: string; status: string; tier: string | null; payment_terms_days: number | null; created_at: number; terms_accepted_at: number | null }>(env.DB,
    `SELECT p.id, p.company, p.contact_name, p.email, p.phone, p.street, p.house_no, p.postcode, p.city, p.country, p.uid, p.language, p.business_type, p.status,
            t.name AS tier, p.payment_terms_days, p.created_at, p.terms_accepted_at
     FROM partners p LEFT JOIN tiers t ON t.id = p.tier_id ORDER BY p.company`);
  return toCsv([['customer_id', 'company', 'contact', 'email', 'phone', 'street', 'postcode', 'city', 'country', 'uid', 'language', 'business_type', 'status', 'tier', 'payment_terms_days', 'since', 'terms_accepted_on'],
    ...rows.map((r) => [r.id, r.company, r.contact_name, r.email, r.phone, `${r.street} ${r.house_no}`.trim(), r.postcode, r.city, r.country, r.uid ?? '', r.language, r.business_type, r.status, r.tier ?? '', r.payment_terms_days ?? '', iso(r.created_at), iso(r.terms_accepted_at)])]);
}

export interface JournalEntry { date: string; doc: string; text: string; debit: string; credit: string; rappen: number; vatRate: string }

/**
 * Double-entry journal (Banana / Bexio / Abacus import style) with the Swiss SME chart by default:
 * invoice → receivables / revenue (net) and receivables / VAT owed (per rate); payment → bank /
 * receivables; credit note → the reverse. A proposal for the accountant: accounts are settings.
 */
export async function journalEntries(env: Env, p: Period, acc: Settings['accounting_accounts']): Promise<JournalEntry[]> {
  return journalFromInvoices(await invoiceRows(env, p), acc);
}

export type JournalSource = Pick<InvoiceExportRow, 'kind' | 'number' | 'issue_date' | 'status' | 'paid_at' | 'net_rappen' | 'total_rappen' | 'vat_breakdown' | 'company' | 'order_ref'>;

/** Pure: invoices / credit notes → balanced journal entries (tested in test/exports.test.ts). */
export function journalFromInvoices(rows: JournalSource[], acc: Settings['accounting_accounts']): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const i of rows) {
    const doc = displayNo(i.kind, i.number);
    const text = `${i.kind === 'credit_note' ? 'Credit note' : 'Invoice'} ${doc} ${i.company} (${i.order_ref})`;
    const br = safeBreakdown(i.vat_breakdown);
    const credit = i.kind === 'credit_note';
    const lines = br.length ? br : [{ rateBp: 0, netRappen: i.net_rappen, vatRappen: 0 }];
    for (const b of lines) {
      out.push(credit
        ? { date: i.issue_date, doc, text, debit: acc.revenue, credit: acc.receivables, rappen: b.netRappen, vatRate: (b.rateBp / 100).toFixed(1) }
        : { date: i.issue_date, doc, text, debit: acc.receivables, credit: acc.revenue, rappen: b.netRappen, vatRate: (b.rateBp / 100).toFixed(1) });
      if (b.vatRappen) out.push(credit
        ? { date: i.issue_date, doc, text: `${text} VAT ${(b.rateBp / 100).toFixed(1)} %`, debit: acc.vat, credit: acc.receivables, rappen: b.vatRappen, vatRate: '' }
        : { date: i.issue_date, doc, text: `${text} VAT ${(b.rateBp / 100).toFixed(1)} %`, debit: acc.receivables, credit: acc.vat, rappen: b.vatRappen, vatRate: '' });
    }
    if (!credit && i.status === 'paid' && i.paid_at) out.push({ date: iso(i.paid_at), doc, text: `Payment ${doc} ${i.company}`, debit: acc.bank, credit: acc.receivables, rappen: i.total_rappen, vatRate: '' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.doc.localeCompare(b.doc));
}

export async function journalCsv(env: Env, p: Period, acc: Settings['accounting_accounts']): Promise<string> {
  const entries = await journalEntries(env, p, acc);
  return toCsv([['date', 'document', 'description', 'debit_account', 'credit_account', 'amount', 'vat_rate'],
    ...entries.map((e) => [e.date, e.doc, e.text, e.debit, e.credit, amount(e.rappen), e.vatRate])]);
}

// Tables in the complete backup. Left out on purpose: sessions, sign-in links, agent/connect secrets,
// rate limits, idempotency records, generated secrets (_mt_meta), shop API credentials and invoice
// PDFs (they are re-created from the data).
const BACKUP_TABLES: Record<string, string> = {
  shop: 'SELECT * FROM shop',
  settings: 'SELECT key, value, updated_at, updated_by FROM settings',
  users: 'SELECT id, email, name, role, created_at FROM users',
  tiers: 'SELECT * FROM tiers',
  partners: 'SELECT * FROM partners',
  partner_users: 'SELECT * FROM partner_users',
  products: 'SELECT * FROM products',
  product_translations: 'SELECT * FROM product_translations',
  vat_rates: 'SELECT * FROM vat_rates',
  orders: 'SELECT * FROM orders',
  order_lines: 'SELECT * FROM order_lines',
  invoices: 'SELECT id, kind, number, order_id, related_invoice_id, partner_id, issue_date, due_date, language, currency, net_rappen, vat_rappen, total_rappen, vat_breakdown, reference, status, paid_at, pdf_sha256, created_at FROM invoices',
  counters: 'SELECT * FROM counters',
  proposals: 'SELECT * FROM proposals',
  integration_outbox: 'SELECT * FROM integration_outbox',
  audit_log: 'SELECT * FROM audit_log',
};

export async function backupJson(env: Env): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(BACKUP_TABLES)) tables[name] = await all(env.DB, sql);
  const migrations = await all<{ name: string }>(env.DB, 'SELECT name FROM _mt_migrations ORDER BY name');
  return JSON.stringify({ format: 'moltenrock-trade.backup.v1', app_version: VERSION, exported_at: new Date().toISOString(), migrations: migrations.map((m) => m.name), tables });
}

export async function buildExport(env: Env, file: ExportFile, period: Period, settings: Settings): Promise<{ body: string; contentType: string; filename: string }> {
  const stamp = period.label === 'all' ? 'all' : period.label;
  switch (file) {
    case 'invoices': return { body: await invoicesCsv(env, period), contentType: 'text/csv; charset=utf-8', filename: `moltenrock-trade-invoices-${stamp}.csv` };
    case 'invoice-lines': return { body: await invoiceLinesCsv(env, period), contentType: 'text/csv; charset=utf-8', filename: `moltenrock-trade-invoice-lines-${stamp}.csv` };
    case 'customers': return { body: await customersCsv(env), contentType: 'text/csv; charset=utf-8', filename: 'moltenrock-trade-customers.csv' };
    case 'journal': return { body: await journalCsv(env, period, settings.accounting_accounts), contentType: 'text/csv; charset=utf-8', filename: `moltenrock-trade-journal-${stamp}.csv` };
    case 'backup': return { body: await backupJson(env), contentType: 'application/json; charset=utf-8', filename: `moltenrock-trade-backup-${new Date().toISOString().slice(0, 10)}.json` };
  }
}

function safeBreakdown(s: string): { rateBp: number; netRappen: number; vatRappen: number }[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
