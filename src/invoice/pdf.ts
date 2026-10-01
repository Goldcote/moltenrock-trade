// A4 invoice PDF with the Swiss QR payment part (receipt + payment part) at the bottom of the
// last page. Uses the standard Helvetica font, which the QR-bill guidelines allow, so no font
// files need to be embedded. Layout follows the SIX style guide dimensions (in millimetres).

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import { bpToPercent, formatDate, rappenToDecimal } from '../money/format';
import type { Totals } from '../money/pricing';
import { pdfText } from '../swiss/charset';
import { formatIban, vatNumberLabel } from '../swiss/validate';
import { qrMatrix } from './qr';

const MM = 72 / 25.4;
const mm = (v: number): number => v * MM;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.35, 0.35, 0.35);
const WHITE = rgb(1, 1, 1);

export interface PdfAddress {
  name: string;
  street: string;
  houseNo: string;
  postcode: string;
  city: string;
  country: string;
}

export interface InvoicePdfInput {
  kind: 'invoice' | 'credit_note';
  number: string;
  lang: Lang;
  issueDate: string;        // YYYY-MM-DD
  serviceDate: string;      // YYYY-MM-DD
  dueDate: string | null;   // YYYY-MM-DD
  orderRef: string;
  poNumber: string;
  termsDays: number | null;
  relatesToNumber?: string;
  shop: PdfAddress & { email: string; uid: string | null; vatRegistered: boolean };
  partner: PdfAddress & { contact: string };
  lines: { qty: number; name: string; sku: string; unitNetRappen: number; lineNetRappen: number }[];
  totals: Totals;
  currency: string;
  /** Payment part; omitted for credit notes. */
  qr: {
    payload: string;
    iban: string;
    reference: { type: 'QRR' | 'SCOR' | 'NON'; value: string };
    message: string;
    billingInfo: string;
    amountRappen: number;
  } | null;
}

const money = (r: number) => {
  const neg = r < 0;
  const [whole, frac] = rappenToDecimal(Math.abs(r)).split('.');
  return `${neg ? '-' : ''}${(whole as string).replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${frac}`;
};

function formatReference(ref: { type: string; value: string }): string {
  if (ref.type === 'QRR') {
    const v = ref.value;
    return [v.slice(0, 2), ...(v.slice(2).match(/.{1,5}/g) ?? [])].join(' ');
  }
  return ref.value.replace(/(.{4})/g, '$1 ').trim();
}

class Writer {
  constructor(public page: PDFPage, readonly font: PDFFont, readonly bold: PDFFont) {}
  text(s: string, xMm: number, yMm: number, size: number, opts: { bold?: boolean; color?: typeof BLACK; maxWidthMm?: number; alignRight?: boolean } = {}) {
    const font = opts.bold ? this.bold : this.font;
    let str = pdfText(s);
    if (opts.maxWidthMm && font.widthOfTextAtSize(str, size) > mm(opts.maxWidthMm)) {
      while (str.length > 1 && font.widthOfTextAtSize(str + '…', size) > mm(opts.maxWidthMm)) str = str.slice(0, -1);
      str += '…';
    }
    const w = font.widthOfTextAtSize(str, size);
    this.page.drawText(str, { x: opts.alignRight ? mm(xMm) - w : mm(xMm), y: mm(yMm), size, font, color: opts.color ?? BLACK });
  }
  /** Greedy wrap (by words, falling back to characters for long tokens like S1 strings). Returns lines. */
  wrap(s: string, size: number, maxWidthMm: number, bold = false): string[] {
    const font = bold ? this.bold : this.font;
    const max = mm(maxWidthMm);
    const fits = (x: string) => font.widthOfTextAtSize(x, size) <= max;
    const out: string[] = [];
    let cur = '';
    for (const word of pdfText(s).split(' ')) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (fits(candidate)) { cur = candidate; continue; }
      if (cur) out.push(cur);
      cur = '';
      let rest = word;
      while (!fits(rest)) {
        let i = rest.length;
        while (i > 1 && !fits(rest.slice(0, i))) i--;
        out.push(rest.slice(0, i));
        rest = rest.slice(i);
      }
      cur = rest;
    }
    if (cur) out.push(cur);
    return out;
  }
  line(x1: number, y1: number, x2: number, y2: number, dash = false, thickness = 0.5) {
    this.page.drawLine({ start: { x: mm(x1), y: mm(y1) }, end: { x: mm(x2), y: mm(y2) }, thickness, color: BLACK, ...(dash ? { dashArray: [3, 3] } : {}) });
  }
}

const addressLines = (a: PdfAddress): string[] => [a.name, `${a.street} ${a.houseNo}`.trim(), `${a.country === 'CH' ? '' : a.country + '-'}${a.postcode} ${a.city}`];

export async function renderInvoicePdf(inv: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const title = t(inv.lang, inv.kind === 'invoice' ? 'inv.invoice' : 'inv.creditNote');
  doc.setTitle(`${title} ${inv.number}`);
  doc.setAuthor(pdfText(inv.shop.name));
  doc.setProducer('MoltenRock Trade');
  doc.setCreator('MoltenRock Trade');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = (k: Parameters<typeof t>[1], v?: Record<string, string | number>) => t(inv.lang, k, v);

  let page = doc.addPage([mm(210), mm(297)]);
  let w = new Writer(page, font, bold);

  // --- Letterhead (sender) ---------------------------------------------------------------------
  w.text(inv.shop.name, 20, 277, 11, { bold: true });
  let y = 272;
  for (const l of addressLines(inv.shop).slice(1)) { w.text(l, 20, y, 8.5, { color: GREY }); y -= 4; }
  w.text(inv.shop.email, 20, y, 8.5, { color: GREY }); y -= 4;
  if (inv.shop.uid) w.text(inv.shop.vatRegistered ? vatNumberLabel(inv.shop.uid, inv.lang) : inv.shop.uid, 20, y, 8.5, { color: GREY });

  // --- Recipient (right-hand window) ------------------------------------------------------------
  y = 247;
  w.text(inv.partner.name, 118, y, 10, { bold: true }); y -= 4.6;
  if (inv.partner.contact) { w.text(inv.partner.contact, 118, y, 10); y -= 4.6; }
  for (const l of addressLines(inv.partner).slice(1)) { w.text(l, 118, y, 10); y -= 4.6; }

  // --- Title + facts ------------------------------------------------------------------------------
  w.text(`${title} ${inv.number}`, 20, 205, 16, { bold: true });
  const facts: [string, string][] = [
    [L('inv.date'), formatDate(inv.issueDate, inv.lang)],
    [L('inv.serviceDate'), formatDate(inv.serviceDate, inv.lang)],
    ...(inv.dueDate ? [[L('inv.due'), formatDate(inv.dueDate, inv.lang)] as [string, string]] : []),
    [L('inv.order'), inv.orderRef],
    ...(inv.poNumber ? [[L('inv.po'), inv.poNumber] as [string, string]] : []),
    ...(inv.relatesToNumber ? [['', L('inv.relatesTo', { number: inv.relatesToNumber })] as [string, string]] : []),
  ];
  y = 196;
  for (const [k, v] of facts) { w.text(k, 20, y, 8.5, { color: GREY }); w.text(v, 60, y, 8.5); y -= 4.4; }

  // --- Line items (paginate; the last page keeps room for totals + payment part) -------------------
  const header = (yy: number) => {
    w.text(L('inv.qty'), 20, yy, 8, { bold: true });
    w.text(L('inv.item'), 34, yy, 8, { bold: true });
    w.text(L('inv.unit'), 160, yy, 8, { bold: true, alignRight: true });
    w.text(`${L('inv.amount')} ${inv.currency}`, 190, yy, 8, { bold: true, alignRight: true });
    w.line(20, yy - 1.8, 190, yy - 1.8);
    return yy - 6;
  };
  y = header(y - 4);
  const bottomWithPayment = 105 + 12 + 6 * (2 + inv.totals.breakdown.length);
  for (let i = 0; i < inv.lines.length; i++) {
    const ln = inv.lines[i]!;
    const remaining = inv.lines.length - i;
    const floor = remaining <= 1 ? bottomWithPayment : 30;
    if (y < floor) {
      page = doc.addPage([mm(210), mm(297)]);
      w = new Writer(page, font, bold);
      w.text(`${title} ${inv.number}`, 20, 280, 9, { bold: true });
      y = header(270);
    }
    w.text(String(ln.qty), 20, y, 8.5);
    w.text(ln.sku ? `${ln.name}  (${ln.sku})` : ln.name, 34, y, 8.5, { maxWidthMm: 104 });
    w.text(money(ln.unitNetRappen), 160, y, 8.5, { alignRight: true });
    w.text(money(ln.lineNetRappen), 190, y, 8.5, { alignRight: true });
    y -= 5;
  }
  if (inv.qr && y < bottomWithPayment) {
    page = doc.addPage([mm(210), mm(297)]);
    w = new Writer(page, font, bold);
    y = 270;
  }

  // --- Totals ------------------------------------------------------------------------------------
  w.line(120, y + 2.5, 190, y + 2.5);
  y -= 2;
  w.text(L('inv.subtotal'), 120, y, 8.5); w.text(money(inv.totals.subtotalNetRappen), 190, y, 8.5, { alignRight: true }); y -= 5;
  for (const b of inv.totals.breakdown) {
    w.text(L('inv.vatLine', { rate: bpToPercent(b.rateBp), net: money(b.netRappen) }), 120, y, 8.5);
    w.text(money(b.vatRappen), 190, y, 8.5, { alignRight: true }); y -= 5;
  }
  w.line(120, y + 3, 190, y + 3);
  w.text(`${L('inv.total')} ${inv.currency}`, 120, y - 1, 10, { bold: true });
  w.text(money(inv.totals.totalRappen), 190, y - 1, 10, { bold: true, alignRight: true });
  y -= 9;
  if (inv.termsDays !== null && inv.kind === 'invoice') w.text(L('inv.terms', { days: inv.termsDays }), 20, y, 8.5);

  if (inv.qr) drawPaymentPart(w, inv, L);
  return doc.save();
}

function drawPaymentPart(w: Writer, inv: InvoicePdfInput, L: (k: Parameters<typeof t>[1], v?: Record<string, string | number>) => string) {
  const qr = inv.qr!;
  // Separation lines: horizontal at 105 mm and vertical at 62 mm (perforation to be cut along).
  w.line(0, 105, 210, 105, true);
  w.line(62, 0, 62, 105, true);

  const creditor = [formatIban(qr.iban), ...addressLines(inv.shop)];
  const debtor = addressLines(inv.partner);
  const ref = qr.reference.type === 'NON' ? null : formatReference(qr.reference);

  // Receipt (0–62 mm): titles 11 pt, headings 6 pt bold, values 8 pt.
  let y = 97;
  w.text(L('qr.receipt'), 5, y, 11, { bold: true }); y -= 7;
  w.text(L('qr.account'), 5, y, 6, { bold: true }); y -= 3.2;
  for (const l of creditor) { w.text(l, 5, y, 8, { maxWidthMm: 52 }); y -= 3.4; }
  if (ref) { y -= 2; w.text(L('qr.reference'), 5, y, 6, { bold: true }); y -= 3.2; w.text(ref, 5, y, 8, { maxWidthMm: 52 }); y -= 3.4; }
  y -= 2; w.text(L('qr.payableBy'), 5, y, 6, { bold: true }); y -= 3.2;
  for (const l of debtor) { w.text(l, 5, y, 8, { maxWidthMm: 52 }); y -= 3.4; }
  w.text(L('qr.currency'), 5, 33, 6, { bold: true });
  w.text(L('qr.amount'), 20, 33, 6, { bold: true });
  w.text(inv.currency, 5, 29, 8);
  w.text(money(qr.amountRappen), 20, 29, 8);
  w.text(L('qr.acceptance'), 57, 16, 6, { bold: true, alignRight: true });

  // Payment part (62–210 mm): title 11 pt, QR 46×46 mm, headings 8 pt bold, values 10 pt.
  w.text(L('qr.paymentPart'), 67, 97, 11, { bold: true });
  drawQr(w, qr.payload, 67, 42, 46);
  w.text(L('qr.currency'), 67, 33, 8, { bold: true });
  w.text(L('qr.amount'), 87, 33, 8, { bold: true });
  w.text(inv.currency, 67, 28.5, 10);
  w.text(money(qr.amountRappen), 87, 28.5, 10);

  y = 97;
  w.text(L('qr.account'), 118, y, 8, { bold: true }); y -= 4;
  for (const l of creditor) { w.text(l, 118, y, 10, { maxWidthMm: 87 }); y -= 4.2; }
  if (ref) { y -= 2; w.text(L('qr.reference'), 118, y, 8, { bold: true }); y -= 4; w.text(ref, 118, y, 10, { maxWidthMm: 87 }); y -= 4.2; }
  const info = [qr.message, qr.billingInfo].filter(Boolean);
  if (info.length) {
    y -= 2; w.text(L('qr.additional'), 118, y, 8, { bold: true }); y -= 4;
    for (const l of info.flatMap((s) => w.wrap(s, 10, 87))) { w.text(l, 118, y, 10); y -= 4.2; }
  }
  y -= 2; w.text(L('qr.payableBy'), 118, y, 8, { bold: true }); y -= 4;
  for (const l of debtor) { w.text(l, 118, y, 10, { maxWidthMm: 87 }); y -= 4.2; }
}

/** Draw the QR matrix as vector squares, then the Swiss cross (7 × 7 mm) in the centre. */
function drawQr(w: Writer, payload: string, xMm: number, yMm: number, sizeMm: number) {
  const m = qrMatrix(payload);
  const n = m.length;
  const cell = sizeMm / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r]![c]) w.page.drawRectangle({ x: mm(xMm + c * cell), y: mm(yMm + sizeMm - (r + 1) * cell), width: mm(cell) + 0.05, height: mm(cell) + 0.05, color: BLACK });
    }
  }
  const cx = xMm + sizeMm / 2;
  const cy = yMm + sizeMm / 2;
  const box = (s: number, color: typeof BLACK) => w.page.drawRectangle({ x: mm(cx - s / 2), y: mm(cy - s / 2), width: mm(s), height: mm(s), color });
  box(7, WHITE);
  box(6, BLACK);
  // White cross with Swiss-flag proportions (arm width 6/32, length 20/32 of the square).
  const u = 6 / 32;
  w.page.drawRectangle({ x: mm(cx - 3 * u), y: mm(cy - 10 * u), width: mm(6 * u), height: mm(20 * u), color: WHITE });
  w.page.drawRectangle({ x: mm(cx - 10 * u), y: mm(cy - 3 * u), width: mm(20 * u), height: mm(6 * u), color: WHITE });
}
