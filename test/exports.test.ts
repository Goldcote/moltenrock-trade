import { describe, expect, it } from 'vitest';
import { journalFromInvoices, parsePeriod, toCsv, type JournalSource } from '../src/domain/exports';

const ACC = { receivables: '1100', revenue: '3200', vat: '2200', bank: '1020' };
const inv = (o: Partial<JournalSource>): JournalSource => ({
  kind: 'invoice', number: 73, issue_date: '2026-09-14', status: 'open', paid_at: null, net_rappen: 53_215, total_rappen: 57_528,
  vat_breakdown: JSON.stringify([{ rateBp: 810, netRappen: 53_215, vatRappen: 4_313 }]), company: 'Hôtel Beau-Séjour SA', order_ref: 'MT-ABC234', ...o,
});

describe('CSV for Swiss Excel', () => {
  it('starts with a UTF-8 BOM, uses semicolons and CRLF', () => {
    const csv = toCsv([['a', 'b'], [1, 'Zürich']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿a;b\r\n1;Zürich\r\n');
  });
  it('quotes separators, quotes and line breaks', () => {
    expect(toCsv([['Muster; AG', 'say "hi"', 'two\nlines']])).toBe('﻿"Muster; AG";"say ""hi""";"two\nlines"\r\n');
  });
  it('neutralises spreadsheet formulas in customer-typed text but keeps negative amounts', () => {
    const csv = toCsv([['=HYPERLINK("http://x")', '+41 44', '@SUM(A1)', { num: -1250 }]]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'+41 44`);
    expect(csv).toContain(`'@SUM`);
    expect(csv.trim().endsWith(';-12.50')).toBe(true);
  });
});

describe('periods', () => {
  it('years, quarters, months and all', () => {
    expect(parsePeriod('2026')).toEqual({ label: '2026', from: '2026-01-01', to: '2027-01-01' });
    expect(parsePeriod('2026-Q4')).toEqual({ label: '2026-Q4', from: '2026-10-01', to: '2027-01-01' });
    expect(parsePeriod('2026-q2')).toMatchObject({ from: '2026-04-01', to: '2026-07-01' });
    expect(parsePeriod('2026-12')).toMatchObject({ from: '2026-12-01', to: '2027-01-01' });
    expect(parsePeriod('all').label).toBe('all');
    expect(parsePeriod('', new Date('2026-09-30T10:00:00Z')).label).toBe('2026');
    expect(() => parsePeriod('2026-13')).toThrow();
    expect(() => parsePeriod("2026'; DROP TABLE")).toThrow();
  });
});

describe('bookkeeping journal', () => {
  const sum = (es: ReturnType<typeof journalFromInvoices>, acc: string, side: 'debit' | 'credit') => es.filter((e) => e[side] === acc).reduce((a, e) => a + e.rappen, 0);

  it('invoice: receivables against revenue (net) and VAT owed; payment clears receivables', () => {
    const es = journalFromInvoices([inv({ status: 'paid', paid_at: Date.parse('2026-09-25T09:00:00Z') })], ACC);
    expect(es).toHaveLength(3);
    expect(sum(es, '1100', 'debit')).toBe(57_528);
    expect(sum(es, '3200', 'credit')).toBe(53_215);
    expect(sum(es, '2200', 'credit')).toBe(4_313);
    expect(es.find((e) => e.debit === '1020')).toMatchObject({ credit: '1100', rappen: 57_528, date: '2026-09-25' });
    // Every entry is balanced by construction; receivables end at zero once paid.
    expect(sum(es, '1100', 'debit') - sum(es, '1100', 'credit')).toBe(0);
  });

  it('credit note reverses revenue and VAT', () => {
    const es = journalFromInvoices([inv({ kind: 'credit_note', number: 4, total_rappen: 57_528 })], ACC);
    expect(sum(es, '3200', 'debit')).toBe(53_215);
    expect(sum(es, '2200', 'debit')).toBe(4_313);
    expect(sum(es, '1100', 'credit')).toBe(57_528);
    expect(es[0]!.doc).toBe('GS-000004');
  });

  it('shop not registered for VAT: one net booking, no VAT line', () => {
    const es = journalFromInvoices([inv({ vat_breakdown: '[]', total_rappen: 53_215 })], ACC);
    expect(es).toEqual([expect.objectContaining({ debit: '1100', credit: '3200', rappen: 53_215 })]);
  });

  it('uses the configured accounts', () => {
    const es = journalFromInvoices([inv({})], { receivables: '1101', revenue: '3400', vat: '2201', bank: '1021' });
    expect(new Set(es.flatMap((e) => [e.debit, e.credit]))).toEqual(new Set(['1101', '3400', '2201']));
  });
});
