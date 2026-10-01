// Pricing & money rules (locked decisions 1, 2, 4, 6, 7).
// All amounts are integer rappen; discounts and VAT rates are integer basis points
// (discount 4000 = 40 %, VAT 810 = 8.1 %). Maths is done in BigInt so nothing drifts, and each
// line is rounded half-up exactly ONCE.

const B = BigInt;
const BP = 10_000n;

/** round(num / den) half-up, for non-negative num and positive den. */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error('denominator must be positive');
  if (num < 0n) return -divRoundHalfUp(-num, den);
  return (2n * num + den) / (2n * den);
}

export interface LineInput {
  priceRappen: number;        // the shop's raw list price for one unit
  pricesIncludeTax: boolean;  // is that price gross (incl. VAT)?
  vatRateBp: number;          // e.g. 810
  discountBp: number;         // the partner's tier discount, e.g. 4000
  qty: number;
}

/**
 * Net line amount (excl. VAT) after the tier discount.
 * Decision 6: the discount applies to the price EXCLUDING VAT. For tax-inclusive shops
 * net = gross ÷ (1 + rate), kept exact until the line total, then rounded once.
 */
export function lineNetRappen(i: LineInput): number {
  assertLine(i);
  const disc = BP - B(i.discountBp);
  const num = B(i.qty) * B(i.priceRappen) * disc;
  const den = i.pricesIncludeTax ? BP + B(i.vatRateBp) : BP;
  return Number(divRoundHalfUp(num, den));
}

/** Net unit price for display (rounded once, on its own). Totals always use lineNetRappen. */
export const unitNetRappen = (i: Omit<LineInput, 'qty'>): number => lineNetRappen({ ...i, qty: 1 });

function assertLine(i: LineInput): void {
  if (!Number.isSafeInteger(i.priceRappen) || i.priceRappen < 0) throw new Error('priceRappen must be a non-negative integer');
  if (!Number.isInteger(i.vatRateBp) || i.vatRateBp < 0 || i.vatRateBp > 10_000) throw new Error('vatRateBp out of range');
  if (!Number.isInteger(i.discountBp) || i.discountBp < 0 || i.discountBp > 9_900) throw new Error('discountBp out of range');
  if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 999) throw new Error('qty must be 1–999');
}

export interface VatLine { vatRateBp: number; lineNetRappen: number }
export interface VatBreakdown { rateBp: number; netRappen: number; vatRappen: number }
export interface Totals {
  subtotalNetRappen: number;
  vatRappen: number;
  totalRappen: number;
  breakdown: VatBreakdown[];
}

/**
 * Basket/invoice totals. VAT is computed per rate on the summed net amounts and rounded half-up
 * once per rate. If the merchant is not VAT-registered, no VAT is charged or shown (Art. 27 MWSTG:
 * showing VAT without being registered creates a liability).
 */
export function totals(lines: VatLine[], vatRegistered: boolean): Totals {
  const byRate = new Map<number, number>();
  let subtotal = 0;
  for (const l of lines) {
    subtotal += l.lineNetRappen;
    byRate.set(l.vatRateBp, (byRate.get(l.vatRateBp) ?? 0) + l.lineNetRappen);
  }
  const breakdown: VatBreakdown[] = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rateBp, net]) => ({
      rateBp,
      netRappen: net,
      vatRappen: vatRegistered ? Number(divRoundHalfUp(B(net) * B(rateBp), BP)) : 0,
    }));
  const vat = breakdown.reduce((s, b) => s + b.vatRappen, 0);
  return { subtotalNetRappen: subtotal, vatRappen: vat, totalRappen: subtotal + vat, breakdown: vatRegistered ? breakdown : [] };
}

/** Decision 2: minimum order on the NET subtotal. */
export function checkMinimum(subtotalNetRappen: number, minRappen: number): { ok: boolean; missingRappen: number } {
  const missing = Math.max(0, minRappen - subtotalNetRappen);
  return { ok: missing === 0, missingRappen: missing };
}

/**
 * Decision 1: baskets STRICTLY GREATER than the threshold wait for approval.
 * threshold null → never hold; 0 → hold every basket; trusted partners are never held.
 */
export function needsApproval(subtotalNetRappen: number, thresholdRappen: number | null, trusted = false): boolean {
  if (trusted || thresholdRappen === null) return false;
  if (thresholdRappen === 0) return true;
  return subtotalNetRappen > thresholdRappen;
}

/** Decision 7: any whole quantity 1–999; optional carton multiple and per-product minimum. */
export function validateQty(qty: number, cartonMultiple: number | null, minQty: number | null): { ok: true } | { ok: false; code: string; message: string } {
  if (!Number.isInteger(qty) || qty < 1 || qty > 999) return { ok: false, code: 'QTY_RANGE', message: 'Quantity must be a whole number from 1 to 999.' };
  if (minQty && qty < minQty) return { ok: false, code: 'QTY_MIN', message: `Minimum quantity is ${minQty}.` };
  if (cartonMultiple && cartonMultiple > 1 && qty % cartonMultiple !== 0)
    return { ok: false, code: 'QTY_CARTON', message: `Quantity must be a multiple of ${cartonMultiple} (carton size).` };
  return { ok: true };
}

export interface VatRateRow { code: string; rate_bp: number; valid_from: string; valid_to: string | null }

/** Pick the VAT rate valid on a given date (YYYY-MM-DD). Rates carry effective dates (e.g. 2028 changes). */
export function vatRateFor(code: string, dateISO: string, rates: VatRateRow[]): number {
  const match = rates
    .filter((r) => r.code === code && r.valid_from <= dateISO && (r.valid_to === null || dateISO < r.valid_to))
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
  if (!match) throw new Error(`No VAT rate '${code}' valid on ${dateISO}`);
  return match.rate_bp;
}

/** Parse a decimal money string like "36.95" or "1'234.50" into rappen, exactly (no floats). */
export function parseMoneyToRappen(input: string): number | null {
  const s = input.replace(/['’\s]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const v = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -v : v;
}
