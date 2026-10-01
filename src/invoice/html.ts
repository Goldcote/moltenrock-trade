// Print-ready HTML invoice with the Swiss QR payment part. It costs ~5 ms CPU (QR code as SVG), so it
// works on Cloudflare's free plan; the browser's "Print → Save as PDF" produces the PDF. Layout mirrors
// the PDF renderer and the SIX style guide (A4, payment part 105 mm high, receipt 62 mm wide, QR 46 mm).

import { t, type MsgKey } from '../i18n';
import { html, raw, type Html } from '../lib/html';
import { bpToPercent, formatDate, rappenToDecimal } from '../money/format';
import { formatIban, vatNumberLabel } from '../swiss/validate';
import type { InvoicePdfInput, PdfAddress } from './pdf';
import { qrMatrix } from './qr';

const money = (r: number) => {
  const [whole, frac] = rappenToDecimal(Math.abs(r)).split('.');
  return `${r < 0 ? '-' : ''}${(whole as string).replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${frac}`;
};
const addr = (a: PdfAddress) => [a.name, `${a.street} ${a.houseNo}`.trim(), `${a.country === 'CH' ? '' : a.country + '-'}${a.postcode} ${a.city}`];
const ref = (r: { type: string; value: string }) =>
  r.type === 'QRR' ? [r.value.slice(0, 2), ...(r.value.slice(2).match(/.{1,5}/g) ?? [])].join(' ') : r.value.replace(/(.{4})/g, '$1 ').trim();

/** Swiss QR code as SVG: modules merged into horizontal runs, Swiss cross (7 × 7 mm) in the centre. */
export function qrSvg(payload: string): Html {
  const m = qrMatrix(payload);
  const n = m.length;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m[r]![c]) { c++; continue; }
      const start = c;
      while (c < n && m[r]![c]) c++;
      d += `M${start} ${r}h${c - start}v1h-${c - start}z`;
    }
  }
  const u = n / 46; // SVG units per millimetre
  const cx = n / 2;
  const box = (mmSize: number) => (mmSize * u).toFixed(3);
  const k = 6 / 32; // Swiss-flag proportions inside the 6 mm black square
  return raw(`<svg class="qr" viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="Swiss QR code">
<path d="${d}" fill="#000"/>
<rect x="${(cx - (7 * u) / 2).toFixed(3)}" y="${(cx - (7 * u) / 2).toFixed(3)}" width="${box(7)}" height="${box(7)}" fill="#fff"/>
<rect x="${(cx - (6 * u) / 2).toFixed(3)}" y="${(cx - (6 * u) / 2).toFixed(3)}" width="${box(6)}" height="${box(6)}" fill="#000"/>
<rect x="${(cx - 3 * k * u).toFixed(3)}" y="${(cx - 10 * k * u).toFixed(3)}" width="${(6 * k * u).toFixed(3)}" height="${(20 * k * u).toFixed(3)}" fill="#fff"/>
<rect x="${(cx - 10 * k * u).toFixed(3)}" y="${(cx - 3 * k * u).toFixed(3)}" width="${(20 * k * u).toFixed(3)}" height="${(6 * k * u).toFixed(3)}" fill="#fff"/>
</svg>`);
}

export function renderInvoiceHtml(inv: InvoicePdfInput, opts: { pdfHref?: string; backHref?: string } = {}): Html {
  const L = (k: MsgKey, v?: Record<string, string | number>) => t(inv.lang, k, v);
  const title = `${L(inv.kind === 'invoice' ? 'inv.invoice' : 'inv.creditNote')} ${inv.number}`;
  const facts: [string, string][] = [
    [L('inv.date'), formatDate(inv.issueDate, inv.lang)],
    [L('inv.serviceDate'), formatDate(inv.serviceDate, inv.lang)],
    ...(inv.dueDate ? [[L('inv.due'), formatDate(inv.dueDate, inv.lang)] as [string, string]] : []),
    [L('inv.order'), inv.orderRef],
    ...(inv.poNumber ? [[L('inv.po'), inv.poNumber] as [string, string]] : []),
    ...(inv.relatesToNumber ? [['', L('inv.relatesTo', { number: inv.relatesToNumber })] as [string, string]] : []),
  ];
  const qr = inv.qr;
  const creditor = qr ? [formatIban(qr.iban), ...addr(inv.shop)] : [];
  const debtor = addr(inv.partner);
  const reference = qr && qr.reference.type !== 'NON' ? ref(qr.reference) : null;
  const lines = (xs: string[]) => xs.map((x) => html`<div>${x}</div>`);

  return html`<html lang="${inv.lang}-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${inv.shop.name}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/invoice.css"><script src="/app.js" defer></script></head>
<body class="invoice">
<nav class="noprint">${opts.backHref ? html`<a href="${opts.backHref}">←</a>` : ''}<button type="button" data-print>Print / PDF</button>${opts.pdfHref ? html`<a href="${opts.pdfHref}">PDF</a>` : ''}</nav>
<article class="sheet">
  <header class="sender"><strong>${inv.shop.name}</strong>${lines(addr(inv.shop).slice(1))}<div>${inv.shop.email}</div>
    ${inv.shop.uid ? html`<div>${inv.shop.vatRegistered ? vatNumberLabel(inv.shop.uid, inv.lang) : inv.shop.uid}</div>` : ''}</header>
  <address class="recipient"><strong>${inv.partner.name}</strong>${inv.partner.contact ? html`<div>${inv.partner.contact}</div>` : ''}${lines(addr(inv.partner).slice(1))}</address>
  <section class="body">
    <h1>${title}</h1>
    <dl class="facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
    <table class="lines"><thead><tr><th>${L('inv.qty')}</th><th>${L('inv.item')}</th><th class="num">${L('inv.unit')}</th><th class="num">${L('inv.amount')} ${inv.currency}</th></tr></thead>
      <tbody>${inv.lines.map((l) => html`<tr><td>${l.qty}</td><td>${l.name}${l.sku ? html` <span class="sku">(${l.sku})</span>` : ''}</td><td class="num">${money(l.unitNetRappen)}</td><td class="num">${money(l.lineNetRappen)}</td></tr>`)}</tbody></table>
    <table class="totals"><tbody>
      <tr><td>${L('inv.subtotal')}</td><td class="num">${money(inv.totals.subtotalNetRappen)}</td></tr>
      ${inv.totals.breakdown.map((b) => html`<tr><td>${L('inv.vatLine', { rate: bpToPercent(b.rateBp), net: money(b.netRappen) })}</td><td class="num">${money(b.vatRappen)}</td></tr>`)}
      <tr class="grand"><td>${L('inv.total')} ${inv.currency}</td><td class="num">${money(inv.totals.totalRappen)}</td></tr></tbody></table>
    ${inv.kind === 'invoice' && inv.termsDays ? html`<p class="terms">${L('inv.terms', { days: inv.termsDays })}</p>` : ''}
  </section>
  ${qr ? html`<section class="payment" aria-label="${L('qr.paymentPart')}">
    <div class="receipt">
      <h2>${L('qr.receipt')}</h2>
      <h3>${L('qr.account')}</h3>${lines(creditor)}
      ${reference ? html`<h3>${L('qr.reference')}</h3><div>${reference}</div>` : ''}
      <h3>${L('qr.payableBy')}</h3>${lines(debtor)}
      <div class="amount"><div><h3>${L('qr.currency')}</h3><div>${inv.currency}</div></div><div><h3>${L('qr.amount')}</h3><div>${money(qr.amountRappen)}</div></div></div>
      <div class="acceptance">${L('qr.acceptance')}</div>
    </div>
    <div class="pay">
      <div class="pay-left"><h2>${L('qr.paymentPart')}</h2>${qrSvg(qr.payload)}
        <div class="amount"><div><h3>${L('qr.currency')}</h3><div>${inv.currency}</div></div><div><h3>${L('qr.amount')}</h3><div>${money(qr.amountRappen)}</div></div></div></div>
      <div class="pay-right">
        <h3>${L('qr.account')}</h3>${lines(creditor)}
        ${reference ? html`<h3>${L('qr.reference')}</h3><div>${reference}</div>` : ''}
        <h3>${L('qr.additional')}</h3><div>${qr.message}</div><div class="billing">${qr.billingInfo}</div>
        <h3>${L('qr.payableBy')}</h3>${lines(debtor)}
      </div>
    </div>
  </section>` : ''}
</article>
</body></html>`;
}
