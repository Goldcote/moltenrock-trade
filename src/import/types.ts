import type { Lang } from '../i18n';

export type VatCode = 'standard' | 'reduced' | 'accommodation' | 'zero';

/** One orderable item as read from the merchant's existing shop (read-only). */
export interface ImportedProduct {
  sourceId: string;
  parentSourceId?: string;
  sku: string;
  priceRappen: number;
  pricesIncludeTax: boolean;
  vatCode: VatCode;
  imageUrl: string;
  stockStatus: 'instock' | 'outofstock' | 'onbackorder';
  unpriceable: boolean;
  flagReason: string;
  translations: Partial<Record<Lang, { name: string; shortDesc: string; description: string }>>;
}

export interface ImportResult {
  products: ImportedProduct[];
  currency: string;
  languages: Lang[];
  translationGroups: number;
  warnings: string[];
}

export interface ShopCredentials {
  baseUrl: string;
  key: string;
  secret: string;
  pricesIncludeTax: boolean;
}

/** Every shop platform implements this. Connectors are READ-ONLY by construction. */
export interface ShopConnector {
  readonly kind: 'woocommerce' | 'shopify';
  test(creds: ShopCredentials): Promise<{ ok: true; shopName: string; currency: string } | { ok: false; error: string }>;
  importCatalog(creds: ShopCredentials, defaultLang: Lang): Promise<ImportResult>;
}
