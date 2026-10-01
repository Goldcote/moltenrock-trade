import type { ShopConnector } from './types';
import { wooConnector } from './woocommerce';

/** Shopify slots in here with the same read-only interface (Admin API read_products scope). */
const shopifyConnector: ShopConnector = {
  kind: 'shopify',
  async test() { return { ok: false, error: 'Shopify is not supported yet — coming soon.' }; },
  async importCatalog() { throw new Error('Shopify is not supported yet — coming soon.'); },
};

export const connectors: Record<'woocommerce' | 'shopify', ShopConnector> = { woocommerce: wooConnector, shopify: shopifyConnector };
