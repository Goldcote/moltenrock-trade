import { describe, expect, it } from 'vitest';
import { qrText, pdfText } from '../src/swiss/charset';
import { buildQrPayload, buildS1, QrBillError, type QrAddress } from '../src/swiss/qrbill';
import {
  formatIban, isQrIban, isSwissPostcode, isValidIban, isValidQrr, isValidScor, isValidUid, makeQrr, makeScor, normaliseUid, vatNumberLabel,
} from '../src/swiss/validate';

describe('UID (mod 11 check digit)', () => {
  it('accepts a correct check digit in any common notation', () => {
    expect(isValidUid('CHE-123.456.788')).toBe(true);
    expect(isValidUid('che123456788 MWST')).toBe(true);
    expect(normaliseUid('CHE 123 456 788 TVA')).toBe('CHE-123.456.788');
  });
  it('rejects the classic placeholder and malformed input', () => {
    expect(isValidUid('CHE-123.456.789')).toBe(false);
    expect(isValidUid('CHE-12.345.678')).toBe(false);
    expect(isValidUid('')).toBe(false);
  });
  it('prints MWST/TVA/IVA, never "VAT"', () => {
    expect(vatNumberLabel('CHE123456788', 'de')).toBe('CHE-123.456.788 MWST');
    expect(vatNumberLabel('CHE123456788', 'fr')).toBe('CHE-123.456.788 TVA');
    expect(vatNumberLabel('CHE123456788', 'it')).toBe('CHE-123.456.788 IVA');
    expect(vatNumberLabel('CHE123456788', 'en')).toBe('CHE-123.456.788 MWST');
  });
});

describe('IBAN / QR-IBAN', () => {
  it('validates CH IBANs with mod 97', () => {
    expect(isValidIban('CH93 0076 2011 6238 5295 7')).toBe(true);
    expect(isValidIban('CH93 0076 2011 6238 5295 8')).toBe(false);
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(false); // QR-bills: CH/LI only
  });
  it('detects QR-IBANs by their institution id (30000–31999)', () => {
    expect(isQrIban('CH44 3199 9123 0008 8901 2')).toBe(true);
    expect(isQrIban('CH93 0076 2011 6238 5295 7')).toBe(false);
  });
  it('formats in groups of four', () => {
    expect(formatIban('ch9300762011623852957')).toBe('CH93 0076 2011 6238 5295 7');
  });
});

describe('payment references', () => {
  it('builds ISO 11649 creditor references (the standard example)', () => {
    expect(makeScor('539007547034')).toBe('RF18539007547034');
    expect(isValidScor('RF18 5390 0754 7034')).toBe(true);
    expect(isValidScor('RF19 5390 0754 7034')).toBe(false);
  });
  it('builds QR references with the mod-10 recursive check digit', () => {
    const ref = makeQrr('21000000000313947143000901');
    expect(ref).toBe('210000000003139471430009017');
    expect(isValidQrr(ref)).toBe(true);
    expect(isValidQrr('210000000003139471430009018')).toBe(false);
  });
});

describe('character sets', () => {
  it('keeps Swiss letters for the QR code and trims to the field length', () => {
    expect(qrText('Müller & Söhne – Zürich', 70)).toBe('Müller & Söhne - Zürich');
    expect(qrText('x'.repeat(80), 70)).toHaveLength(70);
  });
  it('transliterates characters the PDF font cannot draw', () => {
    expect(pdfText('Dvořák Čapek')).toBe('Dvorák Capek');
  });
  it('postcodes are 4 digits', () => {
    expect(isSwissPostcode('8001')).toBe(true);
    expect(isSwissPostcode('0800')).toBe(false);
    expect(isSwissPostcode('80011')).toBe(false);
  });
});

const creditor: QrAddress = { name: 'Alpenrose Handels AG', street: 'Musterstrasse', houseNo: '1', postcode: '8001', city: 'Zürich', country: 'CH' };
const debtor: QrAddress = { name: 'Hotel Beispiel AG', street: 'Seeweg', houseNo: '12a', postcode: '6003', city: 'Luzern', country: 'CH' };

describe('QR-bill payload', () => {
  it('produces the IG line layout (normal IBAN + SCOR)', () => {
    const payload = buildQrPayload({
      iban: 'CH93 0076 2011 6238 5295 7', creditor, debtor, amountRappen: 123450, currency: 'CHF',
      reference: { type: 'SCOR', value: makeScor('2026000001') },
      message: 'Bestellung MT-ABC123',
      billingInfo: buildS1({ invoiceNo: '1', invoiceDate: '2026-09-29', termsDays: 14 }),
    });
    const lines = payload.split('\n');
    expect(lines.slice(0, 4)).toEqual(['SPC', '0200', '1', 'CH9300762011623852957']);
    expect(lines.slice(4, 11)).toEqual(['S', 'Alpenrose Handels AG', 'Musterstrasse', '1', '8001', 'Zürich', 'CH']);
    expect(lines.slice(11, 18)).toEqual(['', '', '', '', '', '', '']); // ultimate creditor stays empty
    expect(lines[18]).toBe('1234.50');
    expect(lines[19]).toBe('CHF');
    expect(lines.slice(20, 27)).toEqual(['S', 'Hotel Beispiel AG', 'Seeweg', '12a', '6003', 'Luzern', 'CH']);
    expect(lines[27]).toBe('SCOR');
    expect(isValidScor(lines[28] as string)).toBe(true);
    expect(lines[29]).toBe('Bestellung MT-ABC123');
    expect(lines[30]).toBe('EPD');
    expect(lines[31]).toBe('//S1/10/1/11/260929/40/0:14');
    expect(lines).toHaveLength(32);
  });
  it('enforces the IBAN ⇔ reference rules', () => {
    const base = { creditor, debtor, amountRappen: 100, currency: 'CHF' as const };
    expect(() => buildQrPayload({ ...base, iban: 'CH44 3199 9123 0008 8901 2', reference: { type: 'SCOR', value: makeScor('1') } })).toThrow(QrBillError);
    expect(() => buildQrPayload({ ...base, iban: 'CH93 0076 2011 6238 5295 7', reference: { type: 'QRR', value: makeQrr('1') } })).toThrow(QrBillError);
    expect(() => buildQrPayload({ ...base, iban: 'CH44 3199 9123 0008 8901 2', reference: { type: 'QRR', value: makeQrr('1') } })).not.toThrow();
    expect(() => buildQrPayload({ ...base, currency: 'EUR', iban: 'CH44 3199 9123 0008 8901 2', reference: { type: 'QRR', value: makeQrr('1') } })).toThrow(/CHF/);
  });
  it('limits message + billing information to 140 characters', () => {
    expect(() => buildQrPayload({
      iban: 'CH93 0076 2011 6238 5295 7', creditor, debtor, amountRappen: 100, currency: 'CHF', reference: { type: 'NON' },
      message: 'x'.repeat(120), billingInfo: buildS1({ invoiceNo: '123456789012345678901234567890' }),
    })).toThrow(/140/);
  });
});

describe('S1 billing information', () => {
  it('matches the Swico syntax and escapes slashes', () => {
    expect(buildS1({
      invoiceNo: '10201409', invoiceDate: '2019-05-12', customerRef: '1400.000-53', uid: 'CHE-106.017.086',
      serviceDate: '2018-05-08', vat: [{ rateBp: 770, netRappen: 0 }], termsDays: 30,
    })).toBe('//S1/10/10201409/11/190512/20/1400.000-53/30/106017086/31/180508/32/7.7/40/0:30');
    expect(buildS1({ customerRef: 'PO/2026\\7' })).toBe('//S1/20/PO\\/2026\\\\7');
  });
  it('lists several VAT rates with their net amounts', () => {
    expect(buildS1({ vat: [{ rateBp: 810, netRappen: 100000 }, { rateBp: 260, netRappen: 5120 }] })).toBe('//S1/32/8.1:1000.00;2.6:51.20');
  });
});
