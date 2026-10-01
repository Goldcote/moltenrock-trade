import { describe, expect, it } from 'vitest';
import {
  checkMinimum, divRoundHalfUp, lineNetRappen, needsApproval, parseMoneyToRappen, totals, unitNetRappen, validateQty, vatRateFor,
} from '../src/money/pricing';

describe('line net (decision 6: discount on the price excluding VAT)', () => {
  it('tax-exclusive shop: straight discount', () => {
    expect(lineNetRappen({ priceRappen: 3695, pricesIncludeTax: false, vatRateBp: 810, discountBp: 4000, qty: 2 })).toBe(4434);
  });
  it('tax-inclusive shop: net = gross ÷ 1.081, then discount, rounded once per line', () => {
    // 2 × 36.95 ÷ 1.081 × 0.6 = 41.0176… → 41.02
    expect(lineNetRappen({ priceRappen: 3695, pricesIncludeTax: true, vatRateBp: 810, discountBp: 4000, qty: 2 })).toBe(4102);
    // Unit price shown on its own: 36.95 ÷ 1.081 × 0.6 = 20.5088… → 20.51 (display only)
    expect(unitNetRappen({ priceRappen: 3695, pricesIncludeTax: true, vatRateBp: 810, discountBp: 4000 })).toBe(2051);
  });
  it('rounds half up exactly once', () => {
    expect(lineNetRappen({ priceRappen: 1, pricesIncludeTax: false, vatRateBp: 0, discountBp: 5000, qty: 1 })).toBe(1); // 0.5 → 1
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
  });
  it('rejects out-of-range input', () => {
    expect(() => lineNetRappen({ priceRappen: 100, pricesIncludeTax: false, vatRateBp: 810, discountBp: 0, qty: 0 })).toThrow();
    expect(() => lineNetRappen({ priceRappen: 100, pricesIncludeTax: false, vatRateBp: 810, discountBp: 0, qty: 1000 })).toThrow();
    expect(() => lineNetRappen({ priceRappen: -1, pricesIncludeTax: false, vatRateBp: 810, discountBp: 0, qty: 1 })).toThrow();
  });
});

describe('totals', () => {
  it('computes VAT per rate on summed nets, rounded once per rate', () => {
    const t = totals([
      { vatRateBp: 810, lineNetRappen: 6000 },
      { vatRateBp: 810, lineNetRappen: 4000 },
      { vatRateBp: 260, lineNetRappen: 1234 },
    ], true);
    expect(t.subtotalNetRappen).toBe(11234);
    expect(t.breakdown).toEqual([
      { rateBp: 810, netRappen: 10000, vatRappen: 810 },
      { rateBp: 260, netRappen: 1234, vatRappen: 32 }, // 32.084 → 32
    ]);
    expect(t.vatRappen).toBe(842);
    expect(t.totalRappen).toBe(12076);
  });
  it('charges and shows no VAT when the merchant is not VAT-registered', () => {
    const t = totals([{ vatRateBp: 810, lineNetRappen: 10000 }], false);
    expect(t).toEqual({ subtotalNetRappen: 10000, vatRappen: 0, totalRappen: 10000, breakdown: [] });
  });
});

describe('decision 1: approval threshold is STRICTLY greater', () => {
  it('holds only above the threshold', () => {
    expect(needsApproval(500000, 500000)).toBe(false);
    expect(needsApproval(500001, 500000)).toBe(true);
  });
  it('0 holds every basket, null never holds, trusted partners never held', () => {
    expect(needsApproval(1, 0)).toBe(true);
    expect(needsApproval(99999999, null)).toBe(false);
    expect(needsApproval(99999999, 500000, true)).toBe(false);
  });
});

describe('decision 2: minimum order on the net subtotal', () => {
  it('reports what is missing', () => {
    expect(checkMinimum(19999, 20000)).toEqual({ ok: false, missingRappen: 1 });
    expect(checkMinimum(20000, 20000)).toEqual({ ok: true, missingRappen: 0 });
  });
});

describe('decision 7: quantities', () => {
  it('allows any whole quantity 1–999 by default', () => {
    expect(validateQty(1, null, null).ok).toBe(true);
    expect(validateQty(999, null, null).ok).toBe(true);
    expect(validateQty(0, null, null).ok).toBe(false);
    expect(validateQty(1000, null, null).ok).toBe(false);
    expect(validateQty(2.5, null, null).ok).toBe(false);
  });
  it('enforces carton multiples and minimum quantities when set', () => {
    expect(validateQty(12, 6, null).ok).toBe(true);
    expect(validateQty(10, 6, null)).toMatchObject({ ok: false, code: 'QTY_CARTON' });
    expect(validateQty(2, null, 3)).toMatchObject({ ok: false, code: 'QTY_MIN' });
  });
});

describe('VAT rates carry effective dates', () => {
  const rates = [
    { code: 'standard', rate_bp: 810, valid_from: '2024-01-01', valid_to: '2028-01-01' },
    { code: 'standard', rate_bp: 830, valid_from: '2028-01-01', valid_to: null },
  ];
  it('picks the rate valid on the date', () => {
    expect(vatRateFor('standard', '2027-12-31', rates)).toBe(810);
    expect(vatRateFor('standard', '2028-01-01', rates)).toBe(830);
    expect(() => vatRateFor('reduced', '2027-01-01', rates)).toThrow();
  });
});

describe('parseMoneyToRappen', () => {
  it('parses exactly without floats', () => {
    expect(parseMoneyToRappen('36.95')).toBe(3695);
    expect(parseMoneyToRappen("1'234.5")).toBe(123450);
    expect(parseMoneyToRappen('-311.05')).toBe(-31105);
    expect(parseMoneyToRappen('0.1')).toBe(10);
    expect(parseMoneyToRappen('abc')).toBeNull();
  });
});
