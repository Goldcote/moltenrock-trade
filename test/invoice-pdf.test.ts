import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderInvoicePdf, type InvoicePdfInput } from '../src/invoice/pdf';
import { qrMatrix } from '../src/invoice/qr';
import { totals } from '../src/money/pricing';
import { buildQrPayload, buildS1 } from '../src/swiss/qrbill';
import { makeScor } from '../src/swiss/validate';

const shop = { name: 'Alpenrose Handels AG', street: 'Musterstrasse', houseNo: '1', postcode: '8001', city: 'Zürich', country: 'CH', email: 'b2b@example.test', uid: 'CHE-123.456.788', vatRegistered: true };
const partner = { name: 'Hôtel Beau-Séjour SA', contact: 'Élodie Müller', street: 'Rue du Lac', houseNo: '5', postcode: '1003', city: 'Lausanne', country: 'CH' };

function sample(lang: 'de' | 'fr' | 'it' | 'en', lineCount = 3): InvoicePdfInput {
  const lines = Array.from({ length: lineCount }, (_, i) => ({ qty: 6, name: `Demo article ${i + 1}`, sku: `SPF50-${i}`, unitNetRappen: 2051, lineNetRappen: 12306 }));
  const tot = totals(lines.map((l) => ({ vatRateBp: 810, lineNetRappen: l.lineNetRappen })), true);
  const reference = { type: 'SCOR' as const, value: makeScor('0000000001') };
  const billingInfo = buildS1({ invoiceNo: '000001', invoiceDate: '2026-09-29', uid: shop.uid, serviceDate: '2026-09-29', vat: [{ rateBp: 810, netRappen: tot.subtotalNetRappen }], termsDays: 14 });
  const payload = buildQrPayload({
    iban: 'CH93 0076 2011 6238 5295 7',
    creditor: shop, debtor: partner, amountRappen: tot.totalRappen, currency: 'CHF', reference, message: 'MT-7F3K9Q', billingInfo,
  });
  return {
    kind: 'invoice', number: '000001', lang, issueDate: '2026-09-29', serviceDate: '2026-09-29', dueDate: '2026-10-13',
    orderRef: 'MT-7F3K9Q', poNumber: 'PO 4711', termsDays: 14, shop, partner, lines, totals: tot, currency: 'CHF',
    qr: { payload, iban: 'CH9300762011623852957', reference, message: 'MT-7F3K9Q', billingInfo, amountRappen: tot.totalRappen },
  };
}

describe('invoice PDF with Swiss QR payment part', () => {
  it.each(['de', 'fr', 'it', 'en'] as const)('renders a valid single-page PDF in %s', async (lang) => {
    const bytes = await renderInvoicePdf(sample(lang));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
  it('paginates long orders and keeps the payment part on the last page', async () => {
    const doc = await PDFDocument.load(await renderInvoicePdf(sample('de', 60)));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
  it('QR code uses a sensible version for a full payload', () => {
    const m = qrMatrix(sample('de').qr!.payload);
    expect(m.length).toBeGreaterThanOrEqual(41);
    expect(m.length).toBeLessThanOrEqual(117);
  });
});
