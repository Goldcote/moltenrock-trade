// Swiss QR-bill payload (Swiss Payment Standards, "Swiss Implementation Guidelines QR-bill" v2.x).
// Produces the exact text that is encoded in the Swiss QR code. Only structured addresses (type "S")
// are used — combined addresses (type "K") are no longer accepted by banks.

import { rappenToDecimal } from '../money/format';
import { qrText } from './charset';
import { compactIban, isQrIban, isValidIban, isValidQrr, isValidScor } from './validate';

export interface QrAddress {
  name: string;
  street: string;
  houseNo: string;
  postcode: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
}

export type QrReference = { type: 'QRR'; value: string } | { type: 'SCOR'; value: string } | { type: 'NON' };

export interface QrBillInput {
  iban: string;
  creditor: QrAddress;
  amountRappen: number | null; // null = amount left blank for the payer
  currency: 'CHF' | 'EUR';
  debtor: QrAddress | null;
  reference: QrReference;
  message?: string;        // unstructured message (Ustrd)
  billingInfo?: string;    // structured billing information (StrdBkgInf), e.g. from buildS1()
}

export class QrBillError extends Error {}

function addressLines(a: QrAddress | null): string[] {
  if (!a) return ['', '', '', '', '', '', ''];
  const name = qrText(a.name, 70);
  const city = qrText(a.city, 35);
  const postcode = qrText(a.postcode, 16);
  if (!name || !city || !postcode) throw new QrBillError('Address needs name, postcode and town');
  if (!/^[A-Z]{2}$/.test(a.country)) throw new QrBillError('Country must be a 2-letter ISO code');
  return ['S', name, qrText(a.street, 70), qrText(a.houseNo, 16), postcode, city, a.country];
}

/** Build the QR payload text (lines separated by LF, as permitted by the IG). */
export function buildQrPayload(input: QrBillInput): string {
  const iban = compactIban(input.iban);
  if (!isValidIban(iban)) throw new QrBillError('Invalid CH/LI IBAN');
  const qrIban = isQrIban(iban);

  // Reference rules: QR-IBAN ⇔ QRR; a normal IBAN takes SCOR or NON.
  const ref = input.reference;
  if (qrIban && ref.type !== 'QRR') throw new QrBillError('A QR-IBAN requires a QR reference (QRR)');
  if (!qrIban && ref.type === 'QRR') throw new QrBillError('A QR reference (QRR) requires a QR-IBAN');
  if (ref.type === 'QRR' && !isValidQrr(ref.value)) throw new QrBillError('Invalid QR reference');
  if (ref.type === 'SCOR' && !isValidScor(ref.value)) throw new QrBillError('Invalid creditor reference (SCOR)');
  // IG v2.4 (from Nov 2026): QR-IBAN/QRR is CHF-only.
  if (qrIban && input.currency !== 'CHF') throw new QrBillError('QR-IBAN with QRR is only allowed for CHF');

  let amount = '';
  if (input.amountRappen !== null) {
    if (!Number.isInteger(input.amountRappen) || input.amountRappen < 1 || input.amountRappen > 99_999_999_999)
      throw new QrBillError('Amount must be between 0.01 and 999999999.99');
    amount = rappenToDecimal(input.amountRappen);
  }

  const message = qrText(input.message ?? '', 140);
  const billing = (input.billingInfo ?? '').trim();
  if (message.length + billing.length > 140)
    throw new QrBillError('Message and billing information together may not exceed 140 characters');

  const lines = [
    'SPC', '0200', '1',
    iban,
    ...addressLines(input.creditor),
    '', '', '', '', '', '', '',              // ultimate creditor: reserved, must stay empty
    amount, input.currency,
    ...addressLines(input.debtor),
    ref.type, ref.type === 'NON' ? '' : ref.value.replace(/\s+/g, ''),
    message,
    'EPD',
  ];
  if (billing) lines.push(billing);
  return lines.join('\n');
}

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/\//g, '\\/');

export interface S1Input {
  invoiceNo?: string;          // /10/
  invoiceDate?: string;        // /11/ YYYY-MM-DD
  customerRef?: string;        // /20/ e.g. the buyer's PO number
  uid?: string;                // /30/ creditor UID, digits only
  serviceDate?: string;        // /31/ YYYY-MM-DD
  vat?: { rateBp: number; netRappen: number }[]; // /32/
  termsDays?: number;          // /40/ 0:<days> (no early-payment discount)
}

const yymmdd = (iso: string): string => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
const pct = (bp: number): string => (bp / 100).toFixed(2).replace(/\.?0+$/, '') || '0';

/** Structured billing information, syntax S1 ("Swico"). Values containing / or \ are escaped. */
export function buildS1(i: S1Input): string {
  let s = '//S1';
  if (i.invoiceNo) s += `/10/${esc(i.invoiceNo)}`;
  if (i.invoiceDate) s += `/11/${yymmdd(i.invoiceDate)}`;
  if (i.customerRef) s += `/20/${esc(qrText(i.customerRef, 35))}`;
  if (i.uid) s += `/30/${i.uid.replace(/\D/g, '')}`;
  if (i.serviceDate) s += `/31/${yymmdd(i.serviceDate)}`;
  if (i.vat && i.vat.length === 1) s += `/32/${pct((i.vat[0] as { rateBp: number }).rateBp)}`;
  else if (i.vat && i.vat.length > 1) s += `/32/${i.vat.map((v) => `${pct(v.rateBp)}:${rappenToDecimal(v.netRappen)}`).join(';')}`;
  if (i.termsDays !== undefined) s += `/40/0:${i.termsDays}`;
  return s;
}
