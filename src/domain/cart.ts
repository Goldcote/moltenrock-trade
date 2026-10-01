// Server-side cart and pricing. Only product ids and quantities are ever accepted from outside;
// every price is (re)computed here from the catalog, the partner's tier and the VAT table.

import { isoDate } from '../money/format';
import { lineNetRappen, totals, unitNetRappen, validateQty, vatRateFor, type Totals, type VatRateRow } from '../money/pricing';
import type { Lang } from '../i18n';
import { AppError } from '../lib/http';
import { getProductsByIds, orderableReason, resolveText, type ProductView } from './catalog';
import { all, now, run } from './db';
import type { Partner } from './partners';
import type { Settings, Shop } from './settings';
import { defaultTier, getTier } from './tiers';

export interface PricedLine {
  product_id: number; source_id: string; sku: string; name: string; image_url: string; qty: number;
  unit_net_rappen: number; line_net_rappen: number; vat_code: string; vat_rate_bp: number;
  carton_multiple: number | null; min_qty: number | null;
}

export interface PricedBasket {
  lines: PricedLine[];
  problems: { product_id: number; reason: string }[];
  totals: Totals;
  discount_bp: number;
  tier_name: string;
  min_order_rappen: number;
  missing_rappen: number;
}

export const vatRates = (db: D1Database) => all<VatRateRow>(db, 'SELECT code, rate_bp, valid_from, valid_to FROM vat_rates');

export async function partnerTier(db: D1Database, partner: Partner) {
  return (partner.tier_id ? await getTier(db, partner.tier_id) : null) ?? (await defaultTier(db));
}

/** Price items for a partner on a date. Unavailable items are reported, not silently dropped. */
export async function priceItems(db: D1Database, ctx: { shop: Shop; settings: Settings; partner: Partner; lang: Lang }, items: { product_id: number; qty: number }[], atMs = now()): Promise<PricedBasket> {
  const tier = await partnerTier(db, ctx.partner);
  const rates = await vatRates(db);
  const products = await getProductsByIds(db, items.map((i) => i.product_id));
  const date = isoDate(atMs);
  const lines: PricedLine[] = [];
  const problems: PricedBasket['problems'] = [];
  for (const it of items) {
    const p = products.get(it.product_id);
    if (!p) { problems.push({ product_id: it.product_id, reason: 'no longer available' }); continue; }
    const reason = orderableReason(p, ctx.settings);
    if (reason) { problems.push({ product_id: p.id, reason }); continue; }
    const q = validateQty(it.qty, p.carton_multiple, p.min_qty);
    if (!q.ok) { problems.push({ product_id: p.id, reason: q.message }); continue; }
    const rate = vatRateFor(p.vat_code, date, rates);
    const base = { priceRappen: p.price_rappen, pricesIncludeTax: !!p.prices_include_tax, vatRateBp: rate, discountBp: tier.discount_bp };
    lines.push({
      product_id: p.id, source_id: p.source_id, sku: p.sku, name: resolveText(p, ctx.lang, ctx.settings.language_fallback).name, image_url: p.image_url,
      qty: it.qty, unit_net_rappen: unitNetRappen(base), line_net_rappen: lineNetRappen({ ...base, qty: it.qty }),
      vat_code: p.vat_code, vat_rate_bp: rate, carton_multiple: p.carton_multiple, min_qty: p.min_qty,
    });
  }
  const t = totals(lines.map((l) => ({ vatRateBp: l.vat_rate_bp, lineNetRappen: l.line_net_rappen })), !!ctx.shop.vat_registered);
  const min = ctx.partner.min_order_rappen ?? ctx.settings.min_order_rappen;
  return { lines, problems, totals: t, discount_bp: tier.discount_bp, tier_name: tier.name, min_order_rappen: min, missing_rappen: Math.max(0, min - t.subtotalNetRappen) };
}

/** Price shown next to a product in the catalog for this partner. */
export async function unitPriceFor(db: D1Database, p: ProductView, discountBp: number, atMs = now()): Promise<number> {
  const rate = vatRateFor(p.vat_code, isoDate(atMs), await vatRates(db));
  return unitNetRappen({ priceRappen: p.price_rappen, pricesIncludeTax: !!p.prices_include_tax, vatRateBp: rate, discountBp });
}

export const cartItems = (db: D1Database, partnerId: number) =>
  all<{ product_id: number; qty: number }>(db, 'SELECT product_id, qty FROM cart_items WHERE partner_id = ? ORDER BY rowid', partnerId);

export async function setCartQty(db: D1Database, partnerId: number, productId: number, qty: number, settings: Settings): Promise<void> {
  if (qty === 0) { await run(db, 'DELETE FROM cart_items WHERE partner_id = ? AND product_id = ?', partnerId, productId); return; }
  const p = (await getProductsByIds(db, [productId])).get(productId);
  if (!p) throw new AppError('NOT_FOUND', 'Product not found', 404);
  const reason = orderableReason(p, settings);
  if (reason) throw new AppError('NOT_ORDERABLE', `This product is ${reason}.`);
  const q = validateQty(qty, p.carton_multiple, p.min_qty);
  if (!q.ok) throw new AppError(q.code, q.message);
  await run(db, 'INSERT INTO cart_items (partner_id, product_id, qty) VALUES (?, ?, ?) ON CONFLICT(partner_id, product_id) DO UPDATE SET qty = excluded.qty', partnerId, productId, qty);
}

export const clearCart = (db: D1Database, partnerId: number) => run(db, 'DELETE FROM cart_items WHERE partner_id = ?', partnerId);
