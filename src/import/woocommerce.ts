// WooCommerce connector — READ-ONLY. It only ever issues GET requests to /wp-json/wc/v3 with a
// read-only REST key. Polylang/WPML translation groups are merged into ONE product with per-language
// content (provenance "imported").

import { isLang, type Lang } from '../i18n';
import { parseMoneyToRappen } from '../money/pricing';
import type { ImportedProduct, ImportResult, ShopConnector, ShopCredentials, VatCode } from './types';

// Some shops sit behind Cloudflare, which blocks default library user agents.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) MoltenRock Trade/0.1';

interface WooProduct {
  id: number; name: string; type: string; status: string; sku: string; regular_price: string; price: string;
  tax_class: string; stock_status: string; short_description: string; description: string;
  images?: { src: string }[]; variations?: number[]; lang?: string; translations?: Record<string, number>;
}
interface WooVariation {
  id: number; sku: string; regular_price: string; price: string; tax_class: string; stock_status: string;
  image?: { src: string } | null; attributes?: { name: string; option: string }[];
}

export function normaliseBaseUrl(url: string): string {
  const u = new URL(url.trim());
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('Shop URL must use https');
  return `${u.protocol}//${u.host}`;
}

async function wooGet<T>(creds: ShopCredentials, path: string, params: Record<string, string | number> = {}): Promise<{ data: T; totalPages: number }> {
  const url = new URL(`${normaliseBaseUrl(creds.baseUrl)}/wp-json/wc/v3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    method: 'GET', // the only method this connector ever uses
    headers: { Authorization: `Basic ${btoa(`${creds.key}:${creds.secret}`)}`, 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    const hint = res.status === 401 ? ' (check the key/secret)' : res.status === 403 ? ' (the shop or its firewall refused the request)' : '';
    throw new Error(`WooCommerce GET ${path} failed: HTTP ${res.status}${hint}`);
  }
  return { data: (await res.json()) as T, totalPages: Number(res.headers.get('X-WP-TotalPages') ?? '1') || 1 };
}

const stripHtml = (s: string): string =>
  (s ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

export function vatCodeFromTaxClass(taxClass: string): VatCode {
  const c = (taxClass ?? '').toLowerCase();
  if (!c || c === 'standard') return 'standard';
  if (/(reduced|reduziert|redu|ermäss)/.test(c)) return 'reduced';
  if (/(accommodation|beherberg|hébergement|alloggio)/.test(c)) return 'accommodation';
  if (/(zero|null|exempt|befreit)/.test(c)) return 'zero';
  return 'standard';
}

const stock = (s: string): ImportedProduct['stockStatus'] => (s === 'outofstock' || s === 'onbackorder' ? s : 'instock');

function priceOf(regular: string, price: string): { rappen: number; flag: string } {
  const r = parseMoneyToRappen(regular || price || '');
  if (r === null) return { rappen: 0, flag: 'no price in the shop' };
  if (r < 0) return { rappen: 0, flag: 'negative price (bundle or discount item)' };
  if (r === 0) return { rappen: 0, flag: 'zero price' };
  return { rappen: r, flag: '' };
}

async function fetchAllProducts(creds: ShopCredentials): Promise<WooProduct[]> {
  const out: WooProduct[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, totalPages } = await wooGet<WooProduct[]>(creds, '/products', { per_page: 100, page, status: 'publish' });
    out.push(...data);
    if (page >= totalPages || data.length === 0) break;
  }
  return out;
}

export const wooConnector: ShopConnector = {
  kind: 'woocommerce',

  async test(creds) {
    try {
      await wooGet<unknown[]>(creds, '/products', { per_page: 1 });
      let currency = 'CHF';
      try { currency = (await wooGet<{ code: string }>(creds, '/data/currencies/current')).data.code || 'CHF'; } catch { /* optional */ }
      return { ok: true, shopName: new URL(normaliseBaseUrl(creds.baseUrl)).host, currency };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async importCatalog(creds, defaultLang): Promise<ImportResult> {
    const warnings: string[] = [];
    let currency = 'CHF';
    try { currency = (await wooGet<{ code: string }>(creds, '/data/currencies/current')).data.code || 'CHF'; } catch { warnings.push('Could not read the shop currency; assuming CHF.'); }

    const raw = await fetchAllProducts(creds);
    const byId = new Map(raw.map((p) => [p.id, p]));
    const languages = new Set<Lang>();

    // Group translations: every member of a Polylang/WPML group maps to one canonical product
    // (the default-language member if present, else the lowest id).
    const canonicalOf = new Map<number, number>();
    for (const p of raw) {
      const group = p.translations && Object.keys(p.translations).length ? Object.values(p.translations).filter((id) => byId.has(id)) : [p.id];
      const members = group.length ? group : [p.id];
      const preferred = p.translations?.[defaultLang];
      const canonical = preferred && byId.has(preferred) ? preferred : Math.min(...members);
      for (const id of members) if (!canonicalOf.has(id)) canonicalOf.set(id, canonical);
      if (!canonicalOf.has(p.id)) canonicalOf.set(p.id, canonical);
    }
    const groups = new Map<number, WooProduct[]>();
    for (const p of raw) {
      const c = canonicalOf.get(p.id) ?? p.id;
      groups.set(c, [...(groups.get(c) ?? []), p]);
    }

    const products: ImportedProduct[] = [];
    for (const [canonicalId, members] of groups) {
      const canon = byId.get(canonicalId) ?? (members[0] as WooProduct);
      const texts: ImportedProduct['translations'] = {};
      for (const m of members) {
        const lang: Lang = isLang(m.lang) ? m.lang : members.length === 1 ? defaultLang : defaultLang;
        if (isLang(m.lang)) languages.add(m.lang);
        if (!texts[lang]) texts[lang] = { name: stripHtml(m.name), shortDesc: stripHtml(m.short_description), description: stripHtml(m.description) };
      }
      if (!members.some((m) => isLang(m.lang))) languages.add(defaultLang);

      const kind = canon.type;
      if (kind === 'variable' && canon.variations?.length) {
        let variations: WooVariation[] = [];
        try { variations = (await wooGet<WooVariation[]>(creds, `/products/${canon.id}/variations`, { per_page: 100 })).data; }
        catch (e) { warnings.push(`Variations of product ${canon.id} could not be read: ${(e as Error).message}`); }
        for (const v of variations) {
          const label = (v.attributes ?? []).map((a) => a.option).filter(Boolean).join(' / ');
          const pr = priceOf(v.regular_price, v.price);
          const vt: ImportedProduct['translations'] = {};
          for (const [l, tx] of Object.entries(texts) as [Lang, { name: string; shortDesc: string; description: string }][])
            vt[l] = { name: label ? `${tx.name} – ${label}` : tx.name, shortDesc: tx.shortDesc, description: tx.description };
          products.push({
            sourceId: `v${v.id}`, parentSourceId: String(canon.id), sku: v.sku || canon.sku, priceRappen: pr.rappen,
            pricesIncludeTax: creds.pricesIncludeTax, vatCode: vatCodeFromTaxClass(v.tax_class === 'parent' ? canon.tax_class : v.tax_class),
            imageUrl: v.image?.src ?? canon.images?.[0]?.src ?? '', stockStatus: stock(v.stock_status),
            unpriceable: !!pr.flag, flagReason: pr.flag, translations: vt,
          });
        }
        continue;
      }
      const pr = ['grouped', 'external'].includes(kind) ? { rappen: 0, flag: `${kind} product (not directly orderable)` } : priceOf(canon.regular_price, canon.price);
      const bundle = /bundle|woosb|composite/.test(kind);
      products.push({
        sourceId: String(canon.id), sku: canon.sku, priceRappen: pr.rappen, pricesIncludeTax: creds.pricesIncludeTax,
        vatCode: vatCodeFromTaxClass(canon.tax_class), imageUrl: canon.images?.[0]?.src ?? '', stockStatus: stock(canon.stock_status),
        unpriceable: !!pr.flag || bundle, flagReason: bundle ? 'bundle product (price its components instead)' : pr.flag, translations: texts,
      });
    }
    const translationGroups = [...groups.values()].filter((g) => g.length > 1).length;
    if (!languages.size) languages.add(defaultLang);
    return { products, currency, languages: [...languages], translationGroups, warnings };
  },
};
