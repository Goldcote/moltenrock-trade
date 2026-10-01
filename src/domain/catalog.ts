// Catalog: orderable items with per-language content and provenance (imported / agent / human).

import { LANGS, type Lang } from '../i18n';
import type { Actor } from '../lib/env';
import { AppError } from '../lib/http';
import type { ImportedProduct } from '../import/types';
import { all, audit, now, one, run } from './db';
import type { Settings } from './settings';

export interface ProductRow {
  id: number; source: string; source_id: string; parent_source_id: string | null; sku: string;
  price_rappen: number; prices_include_tax: number; vat_code: string; image_url: string; stock_status: string;
  included: number; unpriceable: number; flag_reason: string; carton_multiple: number | null; min_qty: number | null; sort: number;
  source_url: string; price_confirmed_at: number | null;
  proposed_price_rappen: number | null; proposed_prices_include_tax: number | null; proposed_vat_code: string | null; proposed_at: number | null;
}

/**
 * The one definition of "a trade customer can order this", in SQL. Products an agent added (from the
 * merchant's website, a spreadsheet or a feed) only count once a person has confirmed their price.
 */
export const ORDERABLE_SQL = "included = 1 AND unpriceable = 0 AND NOT (source = 'agent' AND price_confirmed_at IS NULL)";
/** Agent-added products whose price (new, or changed) is waiting for a person. */
export const UNCONFIRMED_SQL = "source = 'agent' AND unpriceable = 0 AND (price_confirmed_at IS NULL OR proposed_price_rappen IS NOT NULL)";
export interface TranslationRow { product_id: number; lang: Lang; name: string; short_desc: string; description: string; unit_text: string; provenance: 'imported' | 'agent' | 'human'; updated_by: string; updated_at: number }

export interface ProductView extends ProductRow {
  translations: Partial<Record<Lang, Omit<TranslationRow, 'product_id' | 'lang'>>>;
  missing_langs: Lang[];
}

/** Resolve display text in `lang`, falling back through the configured order; never returns an empty name. */
export function resolveText(p: ProductView, lang: Lang, fallback: Lang[]): { name: string; short_desc: string; unit_text: string; lang: Lang } {
  for (const l of [lang, ...fallback, ...LANGS]) {
    const tr = p.translations[l];
    if (tr?.name) return { name: tr.name, short_desc: tr.short_desc, unit_text: tr.unit_text, lang: l };
  }
  return { name: p.sku || `#${p.id}`, short_desc: '', unit_text: '', lang };
}

async function attachTranslations(db: D1Database, rows: ProductRow[]): Promise<ProductView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const trs = await all<TranslationRow>(db, `SELECT * FROM product_translations WHERE product_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const by = new Map<number, ProductView['translations']>();
  for (const tr of trs) {
    const { product_id, lang, ...rest } = tr;
    by.set(product_id, { ...(by.get(product_id) ?? {}), [lang]: rest });
  }
  return rows.map((r) => {
    const translations = by.get(r.id) ?? {};
    return { ...r, translations, missing_langs: LANGS.filter((l) => !translations[l]?.name) };
  });
}

export type ProductFilter = 'all' | 'orderable' | 'flagged' | 'excluded' | 'unconfirmed';

export async function listProducts(db: D1Database, opts: { filter?: ProductFilter; limit?: number; cursor?: number; respectStock?: boolean } = {}): Promise<{ items: ProductView[]; next_cursor: number | null }> {
  const where: string[] = ['id > ?'];
  const params: unknown[] = [opts.cursor ?? 0];
  switch (opts.filter ?? 'all') {
    case 'orderable': where.push(ORDERABLE_SQL); if (opts.respectStock) where.push("stock_status != 'outofstock'"); break;
    case 'unconfirmed': where.push(UNCONFIRMED_SQL); break;
    case 'flagged': where.push('unpriceable = 1'); break;
    case 'excluded': where.push('included = 0'); break;
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await all<ProductRow>(db, `SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`, ...params, limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: await attachTranslations(db, page), next_cursor: more ? (page[page.length - 1] as ProductRow).id : null };
}

export async function getProduct(db: D1Database, id: number): Promise<ProductView | null> {
  const row = await one<ProductRow>(db, 'SELECT * FROM products WHERE id = ?', id);
  return row ? ((await attachTranslations(db, [row]))[0] as ProductView) : null;
}

export async function getProductsByIds(db: D1Database, ids: number[]): Promise<Map<number, ProductView>> {
  if (!ids.length) return new Map();
  const rows = await all<ProductRow>(db, `SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return new Map((await attachTranslations(db, rows)).map((p) => [p.id, p]));
}

/** Is this product orderable right now under the shop's settings? */
export function orderableReason(p: ProductRow, settings: Settings): string | null {
  if (p.unpriceable) return 'not priceable';
  if (p.source === 'agent' && !p.price_confirmed_at) return 'waiting for its price to be confirmed';
  if (!p.included) return 'not offered to trade customers';
  if (settings.respect_stock && p.stock_status === 'outofstock') return 'out of stock';
  return null;
}

/**
 * Upsert an import. Merchant/agent decisions (inclusion, carton sizes) are preserved on re-import, and
 * translations written by an agent or a human are never overwritten by imported text.
 */
export async function upsertImported(db: D1Database, actor: Actor, source: string, items: ImportedProduct[], settings: Settings): Promise<{ created: number; updated: number; removed: number; flagged: number }> {
  const before = new Set((await all<{ source_id: string }>(db, 'SELECT source_id FROM products WHERE source = ?', source)).map((r) => r.source_id));
  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  for (const [i, p] of items.entries()) {
    stmts.push(db.prepare(`INSERT INTO products (source, source_id, parent_source_id, sku, price_rappen, prices_include_tax, vat_code, image_url, stock_status, included, unpriceable, flag_reason, sort, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET parent_source_id = excluded.parent_source_id, sku = excluded.sku, price_rappen = excluded.price_rappen,
        prices_include_tax = excluded.prices_include_tax, vat_code = excluded.vat_code, image_url = excluded.image_url, stock_status = excluded.stock_status,
        unpriceable = excluded.unpriceable, flag_reason = excluded.flag_reason, sort = excluded.sort, updated_at = excluded.updated_at,
        included = CASE WHEN excluded.unpriceable = 1 THEN 0 ELSE products.included END`)
      .bind(source, p.sourceId, p.parentSourceId ?? null, p.sku, p.priceRappen, p.pricesIncludeTax ? 1 : 0, p.vatCode, p.imageUrl, p.stockStatus,
        p.unpriceable ? 0 : settings.include_new_products ? 1 : 0, p.unpriceable ? 1 : 0, p.flagReason, i, ts));
    for (const [lang, tr] of Object.entries(p.translations) as [Lang, NonNullable<ImportedProduct['translations'][Lang]>][]) {
      stmts.push(db.prepare(`INSERT INTO product_translations (product_id, lang, name, short_desc, description, unit_text, provenance, updated_by, updated_at)
        SELECT id, ?, ?, ?, ?, '', 'imported', ?, ? FROM products WHERE source = ? AND source_id = ?
        ON CONFLICT(product_id, lang) DO UPDATE SET name = excluded.name, short_desc = excluded.short_desc, description = excluded.description,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at
        WHERE product_translations.provenance = 'imported'`)
        .bind(lang, tr.name, tr.shortDesc, tr.description, `import:${source}`, ts, source, p.sourceId));
    }
  }
  const seen = new Set(items.map((p) => p.sourceId));
  const gone = [...before].filter((id) => !seen.has(id));
  for (const id of gone) stmts.push(db.prepare("UPDATE products SET included = 0, flag_reason = 'no longer in the shop', updated_at = ? WHERE source = ? AND source_id = ?").bind(ts, source, id));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  const created = items.filter((p) => !before.has(p.sourceId)).length;
  const result = { created, updated: items.length - created, removed: gone.length, flagged: items.filter((p) => p.unpriceable).length };
  await audit(db, actor, 'catalog.import', `source:${source}`, result);
  return result;
}

export async function setTranslation(db: D1Database, actor: Actor, input: { product_id: number; lang: Lang; name: string; short_desc?: string; description?: string; unit_text?: string }): Promise<ProductView> {
  if (!LANGS.includes(input.lang)) throw new AppError('INVALID_LANG', `lang must be one of ${LANGS.join(', ')}`);
  const name = input.name?.trim();
  if (!name) throw new AppError('REQUIRED', 'name is required');
  if (name.length > 200 || (input.short_desc ?? '').length > 1000 || (input.description ?? '').length > 10_000) throw new AppError('TOO_LONG', 'name ≤ 200, short_desc ≤ 1000, description ≤ 10000 characters');
  if (!(await one(db, 'SELECT 1 FROM products WHERE id = ?', input.product_id))) throw new AppError('NOT_FOUND', `Product ${input.product_id} not found`, 404);
  const provenance = actor.type === 'agent' ? 'agent' : 'human';
  await run(db, `INSERT INTO product_translations (product_id, lang, name, short_desc, description, unit_text, provenance, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, lang) DO UPDATE SET name = excluded.name, short_desc = excluded.short_desc, description = excluded.description,
      unit_text = excluded.unit_text, provenance = excluded.provenance, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    input.product_id, input.lang, name, input.short_desc?.trim() ?? '', input.description?.trim() ?? '', input.unit_text?.trim() ?? '', provenance, actor.label, now());
  await audit(db, actor, 'catalog.set_translation', `product:${input.product_id}`, { lang: input.lang, provenance });
  return (await getProduct(db, input.product_id)) as ProductView;
}

export async function setVisibility(db: D1Database, actor: Actor, ids: number[], included: boolean): Promise<{ updated: number; skipped_unpriceable: number[] }> {
  if (!ids.length || ids.length > 500) throw new AppError('INVALID', 'Give 1–500 product ids');
  const unpriceable = included ? (await all<{ id: number }>(db, `SELECT id FROM products WHERE unpriceable = 1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids)).map((r) => r.id) : [];
  const ok = ids.filter((id) => !unpriceable.includes(id));
  if (ok.length) await run(db, `UPDATE products SET included = ? WHERE id IN (${ok.map(() => '?').join(',')})`, included ? 1 : 0, ...ok);
  await audit(db, actor, 'catalog.set_visibility', 'products', { ids: ok, included });
  return { updated: ok.length, skipped_unpriceable: unpriceable };
}

export async function setRules(db: D1Database, actor: Actor, id: number, rules: { carton_multiple?: number | null; min_qty?: number | null }): Promise<ProductView> {
  const p = await getProduct(db, id);
  if (!p) throw new AppError('NOT_FOUND', `Product ${id} not found`, 404);
  const check = (v: number | null | undefined, name: string) => {
    if (v === undefined || v === null) return v;
    if (!Number.isInteger(v) || v < 1 || v > 999) throw new AppError('INVALID', `${name} must be 1–999 or null`);
    return v;
  };
  await run(db, 'UPDATE products SET carton_multiple = ?, min_qty = ? WHERE id = ?',
    rules.carton_multiple === undefined ? p.carton_multiple : check(rules.carton_multiple, 'carton_multiple'),
    rules.min_qty === undefined ? p.min_qty : check(rules.min_qty, 'min_qty'), id);
  await audit(db, actor, 'catalog.set_rules', `product:${id}`, rules);
  return (await getProduct(db, id)) as ProductView;
}

export async function translationCoverage(db: D1Database): Promise<{ products: number; by_lang: Record<Lang, { present: number; imported: number; agent: number; human: number }> }> {
  const products = (await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM products WHERE unpriceable = 0'))?.n ?? 0;
  const rows = await all<{ lang: Lang; provenance: string; n: number }>(db,
    `SELECT t.lang, t.provenance, COUNT(*) AS n FROM product_translations t JOIN products p ON p.id = t.product_id WHERE p.unpriceable = 0 GROUP BY t.lang, t.provenance`);
  const by_lang = Object.fromEntries(LANGS.map((l) => [l, { present: 0, imported: 0, agent: 0, human: 0 }])) as Record<Lang, { present: number; imported: number; agent: number; human: number }>;
  for (const r of rows) {
    const b = by_lang[r.lang];
    if (!b) continue;
    b.present += r.n;
    if (r.provenance === 'imported' || r.provenance === 'agent' || r.provenance === 'human') b[r.provenance] += r.n;
  }
  return { products, by_lang };
}

export async function missingTranslations(db: D1Database, lang?: Lang): Promise<{ product_id: number; sku: string; missing: Lang[]; reference: { lang: Lang; name: string; short_desc: string; description: string } | null }[]> {
  const { items } = await listProducts(db, { filter: 'all', limit: 500 });
  return items
    .filter((p) => !p.unpriceable)
    .map((p) => {
      const missing = lang ? p.missing_langs.filter((l) => l === lang) : p.missing_langs;
      const refLang = (LANGS.find((l) => p.translations[l]?.name) ?? null) as Lang | null;
      const ref = refLang ? p.translations[refLang] : undefined;
      return { product_id: p.id, sku: p.sku, missing, reference: refLang && ref ? { lang: refLang, name: ref.name, short_desc: ref.short_desc, description: ref.description } : null };
    })
    .filter((x) => x.missing.length > 0);
}

// ---- Any shop: products the agent adds (from the website, a spreadsheet or a feed) ---------------

const VAT_CODES = ['standard', 'reduced', 'accommodation', 'zero'] as const;
const DECLINED = 'price declined by the owner';
type AgentText = { name: string; short_desc?: string; description?: string };
export interface AgentProductInput {
  source_id: string;                 // a stable key the agent chooses: the product page URL, or the SKU
  parent_source_id?: string | null;  // variants: the source_id of the parent product
  sku?: string;
  source_url?: string;               // where the agent found it (https)
  price_rappen?: number | null;      // null / missing = no price found → set aside, not orderable
  prices_include_tax?: boolean;      // website prices usually include VAT (default true)
  vat_code?: (typeof VAT_CODES)[number];
  image_url?: string;
  in_stock?: boolean;
  texts: Partial<Record<Lang, AgentText>>;
}

const httpsOrEmpty = (v: unknown, field: string) => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || v.length > 500 || !/^https:\/\/[^\s<>"]+$/.test(v)) throw new AppError('INVALID_URL', `${field} must be an https:// address`);
  return v;
};

/**
 * Add or update products the agent read from the merchant's website, a spreadsheet or a feed.
 * Prices it found are NOT live until a person confirms them (Approvals → Prices to confirm). A later
 * price change on a confirmed product waits as a proposal; the confirmed price stays in force.
 * Texts written by a person are never overwritten.
 */
export type AgentUpdatePlan = 'keep_declined' | 'set_aside' | 'refresh_unconfirmed' | 'propose_change' | 'unchanged';

/**
 * What the agent reading a product again does to it (pure; the rules behind upsertAgentProducts):
 * a product the owner declined stays declined; no price → set aside; a price nobody confirmed yet (or
 * one that had disappeared) is simply refreshed and still waits; a different price for a confirmed
 * product becomes a proposal while the confirmed price stays in force.
 */
export function planAgentUpdate(existing: Pick<ProductRow, 'flag_reason' | 'price_confirmed_at' | 'unpriceable' | 'price_rappen' | 'prices_include_tax' | 'vat_code'>,
  next: { price: number | null; pit: number; vat: string }): AgentUpdatePlan {
  if (existing.flag_reason === DECLINED) return 'keep_declined';
  if (next.price === null) return 'set_aside';
  if (!existing.price_confirmed_at || existing.unpriceable) return 'refresh_unconfirmed';
  if (next.price !== existing.price_rappen || next.pit !== existing.prices_include_tax || next.vat !== existing.vat_code) return 'propose_change';
  return 'unchanged';
}

export async function upsertAgentProducts(db: D1Database, actor: Actor, items: AgentProductInput[], settings: Settings):
  Promise<{ created: number; updated: number; waiting_for_price_confirmation: number; set_aside_without_price: number }> {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new AppError('INVALID', 'Send 1–100 products per call.');
  const ts = now();
  let created = 0, updated = 0, waiting = 0, noPrice = 0;
  for (const [i, it] of items.entries()) {
    const sourceId = typeof it.source_id === 'string' ? it.source_id.trim() : '';
    if (!sourceId || sourceId.length > 300) throw new AppError('INVALID', `items[${i}].source_id is required (≤ 300 characters)`);
    const texts = Object.entries(it.texts ?? {}).filter(([l, t]) => LANGS.includes(l as Lang) && t && typeof t.name === 'string' && t.name.trim());
    if (!texts.length) throw new AppError('INVALID', `items[${i}] needs a name in at least one of ${LANGS.join(', ')}`);
    for (const [, t] of texts) if (t!.name.length > 200 || (t!.short_desc ?? '').length > 1000 || (t!.description ?? '').length > 10_000) throw new AppError('TOO_LONG', `items[${i}]: name ≤ 200, short_desc ≤ 1000, description ≤ 10000 characters`);
    const price = it.price_rappen ?? null;
    if (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > 100_000_000)) throw new AppError('INVALID', `items[${i}].price_rappen must be a whole number of rappen (CHF 12.50 = 1250)`);
    const vat = it.vat_code ?? 'standard';
    if (!VAT_CODES.includes(vat)) throw new AppError('INVALID', `items[${i}].vat_code must be one of ${VAT_CODES.join(', ')}`);
    const pit = it.prices_include_tax === false ? 0 : 1;
    const url = httpsOrEmpty(it.source_url, `items[${i}].source_url`);
    const img = httpsOrEmpty(it.image_url, `items[${i}].image_url`);
    const sku = (it.sku ?? '').trim().slice(0, 100);
    const stock = it.in_stock === false ? 'outofstock' : 'instock';
    const parent = it.parent_source_id ? String(it.parent_source_id).slice(0, 300) : null;

    const existing = await one<ProductRow>(db, "SELECT * FROM products WHERE source = 'agent' AND source_id = ?", sourceId);
    if (!existing) {
      await run(db, `INSERT INTO products (source, source_id, parent_source_id, sku, price_rappen, prices_include_tax, vat_code, image_url, stock_status, included, unpriceable, flag_reason, sort, updated_at, source_url)
        VALUES ('agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sourceId, parent, sku, price ?? 0, pit, vat, img, stock, price === null ? 0 : settings.include_new_products ? 1 : 0, price === null ? 1 : 0,
        price === null ? 'no price found' : '', 100_000 + i, ts, url);
      created++;
      if (price === null) noPrice++; else waiting++;
    } else {
      const plan = planAgentUpdate(existing, { price, pit, vat });
      if (plan === 'keep_declined') {
        // The owner declined this product's price: the agent reading it again doesn't bring it back.
        await run(db, 'UPDATE products SET sku = ?, image_url = ?, stock_status = ?, source_url = ?, parent_source_id = ?, updated_at = ? WHERE id = ?',
          sku || existing.sku, img || existing.image_url, stock, url || existing.source_url, parent, ts, existing.id);
      } else if (plan === 'set_aside') {
        await run(db, "UPDATE products SET sku = ?, image_url = ?, stock_status = ?, source_url = ?, parent_source_id = ?, unpriceable = 1, included = 0, flag_reason = 'no price found', updated_at = ? WHERE id = ?",
          sku || existing.sku, img || existing.image_url, stock, url || existing.source_url, parent, ts, existing.id);
        noPrice++;
      } else if (plan === 'refresh_unconfirmed') {
        // Never confirmed, or set aside because the price had disappeared: refresh the price, which
        // (again) waits for a person. A product that had no price becomes offerable like a new one.
        const included = existing.unpriceable ? (settings.include_new_products ? 1 : 0) : existing.included;
        await run(db, "UPDATE products SET sku = ?, image_url = ?, stock_status = ?, source_url = ?, parent_source_id = ?, price_rappen = ?, prices_include_tax = ?, vat_code = ?, unpriceable = 0, flag_reason = '', included = ?, price_confirmed_at = NULL, proposed_price_rappen = NULL, proposed_prices_include_tax = NULL, proposed_vat_code = NULL, proposed_at = NULL, updated_at = ? WHERE id = ?",
          sku || existing.sku, img || existing.image_url, stock, url || existing.source_url, parent, price, pit, vat, included, ts, existing.id);
        waiting++;
      } else if (plan === 'propose_change') {
        // Confirmed price stays in force; the new one waits for a person.
        await run(db, 'UPDATE products SET sku = ?, image_url = ?, stock_status = ?, source_url = ?, parent_source_id = ?, proposed_price_rappen = ?, proposed_prices_include_tax = ?, proposed_vat_code = ?, proposed_at = ?, updated_at = ? WHERE id = ?',
          sku || existing.sku, img || existing.image_url, stock, url || existing.source_url, parent, price as number, pit, vat, ts, ts, existing.id);
        waiting++;
      } else {
        await run(db, 'UPDATE products SET sku = ?, image_url = ?, stock_status = ?, source_url = ?, parent_source_id = ?, proposed_price_rappen = NULL, proposed_prices_include_tax = NULL, proposed_vat_code = NULL, proposed_at = NULL, updated_at = ? WHERE id = ?',
          sku || existing.sku, img || existing.image_url, stock, url || existing.source_url, parent, ts, existing.id);
      }
      updated++;
    }
    const row = await one<{ id: number }>(db, "SELECT id FROM products WHERE source = 'agent' AND source_id = ?", sourceId);
    for (const [lang, t] of texts) {
      // A text a person wrote stays; the agent may refresh its own and imported texts.
      await run(db, `INSERT INTO product_translations (product_id, lang, name, short_desc, description, unit_text, provenance, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, '', 'agent', ?, ?)
        ON CONFLICT(product_id, lang) DO UPDATE SET name = excluded.name, short_desc = excluded.short_desc, description = excluded.description,
          provenance = 'agent', updated_by = excluded.updated_by, updated_at = excluded.updated_at WHERE product_translations.provenance != 'human'`,
        row!.id, lang, t!.name.trim(), (t!.short_desc ?? '').trim(), (t!.description ?? '').trim(), actor.label, ts);
    }
  }
  const result = { created, updated, waiting_for_price_confirmation: waiting, set_aside_without_price: noPrice };
  await audit(db, actor, 'catalog.agent_upsert', 'products', result);
  return result;
}

export interface PriceCheckRow extends ProductRow { name: string | null }

/** What waits for a person: new agent-found prices and changed prices, with a name to show. */
export const listPricesToConfirm = (db: D1Database, lang: Lang) => all<PriceCheckRow>(db,
  `SELECT p.*, COALESCE((SELECT name FROM product_translations t WHERE t.product_id = p.id AND t.lang = ?),
                        (SELECT name FROM product_translations t WHERE t.product_id = p.id ORDER BY t.lang LIMIT 1)) AS name
   FROM products p WHERE ${UNCONFIRMED_SQL} ORDER BY p.proposed_at IS NULL DESC, p.id LIMIT 500`, lang);

export const countPricesToConfirm = async (db: D1Database) => (await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM products WHERE ${UNCONFIRMED_SQL}`))?.n ?? 0;

/** HUMAN-ONLY. Confirm (or decline) agent-found prices. Confirming a change makes the new price live. */
export async function decidePrices(db: D1Database, actor: Actor, ids: number[] | 'all', decision: 'confirm' | 'decline'): Promise<{ confirmed: number; declined: number }> {
  if (actor.type !== 'user') throw new AppError('HUMAN_ONLY', 'Prices are confirmed by a person on the Approvals page, never by an agent.', 403);
  const rows = ids === 'all'
    ? await all<ProductRow>(db, `SELECT * FROM products WHERE ${UNCONFIRMED_SQL}`)
    : ids.length ? await all<ProductRow>(db, `SELECT * FROM products WHERE ${UNCONFIRMED_SQL} AND id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  for (const p of rows) {
    if (decision === 'confirm') {
      stmts.push(p.proposed_price_rappen !== null
        ? db.prepare('UPDATE products SET price_rappen = proposed_price_rappen, prices_include_tax = proposed_prices_include_tax, vat_code = proposed_vat_code, proposed_price_rappen = NULL, proposed_prices_include_tax = NULL, proposed_vat_code = NULL, proposed_at = NULL, price_confirmed_at = ?, updated_at = ? WHERE id = ?').bind(ts, ts, p.id)
        : db.prepare('UPDATE products SET price_confirmed_at = ?, updated_at = ? WHERE id = ?').bind(ts, ts, p.id));
    } else {
      stmts.push(p.proposed_price_rappen !== null
        ? db.prepare('UPDATE products SET proposed_price_rappen = NULL, proposed_prices_include_tax = NULL, proposed_vat_code = NULL, proposed_at = NULL, updated_at = ? WHERE id = ?').bind(ts, p.id)
        : db.prepare('UPDATE products SET included = 0, unpriceable = 1, flag_reason = ?, updated_at = ? WHERE id = ?').bind(DECLINED, ts, p.id));
    }
  }
  if (stmts.length) await db.batch(stmts);
  const result = { confirmed: decision === 'confirm' ? rows.length : 0, declined: decision === 'decline' ? rows.length : 0 };
  if (rows.length) await audit(db, actor, `catalog.${decision}_prices`, 'products', { ...result, ids: rows.map((r) => r.id) });
  return result;
}
