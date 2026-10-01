// Connection to the merchant's existing shop (read-only key, encrypted at rest) + catalog import.

import { connectors } from '../import';
import { normaliseBaseUrl } from '../import/woocommerce';
import type { Actor, Env } from '../lib/env';
import { decryptString, encryptString } from '../lib/crypto';
import { getSecrets } from '../lib/bootstrap';
import { AppError } from '../lib/http';
import { upsertImported } from './catalog';
import { audit, now, one, run } from './db';
import { getSettings, requireShop } from './settings';

export interface ConnectionRow { kind: 'woocommerce' | 'shopify'; base_url: string; prices_include_tax: number; connected_at: number; last_import_at: number | null; last_import_summary: string | null }

export const getConnection = (db: D1Database) =>
  one<ConnectionRow>(db, 'SELECT kind, base_url, prices_include_tax, connected_at, last_import_at, last_import_summary FROM shop_connection WHERE id = 1');

export async function connectShop(env: Env, actor: Actor, input: { kind: 'woocommerce' | 'shopify'; base_url: string; consumer_key: string; consumer_secret: string; prices_include_tax?: boolean }): Promise<ConnectionRow> {
  const connector = connectors[input.kind];
  if (!connector) throw new AppError('UNSUPPORTED', 'kind must be woocommerce (shopify coming soon)');
  let baseUrl: string;
  try { baseUrl = normaliseBaseUrl(input.base_url); } catch (e) { throw new AppError('INVALID_URL', (e as Error).message); }
  if (!input.consumer_key?.trim() || !input.consumer_secret?.trim()) throw new AppError('REQUIRED', 'consumer_key and consumer_secret are required (use a READ-ONLY key)');
  const creds = { baseUrl, key: input.consumer_key.trim(), secret: input.consumer_secret.trim(), pricesIncludeTax: input.prices_include_tax ?? true };
  const test = await connector.test(creds);
  if (!test.ok) throw new AppError('SHOP_UNREACHABLE', `Could not read the shop: ${test.error}`, 502);
  await run(env.DB, `INSERT INTO shop_connection (id, kind, base_url, key_enc, secret_enc, prices_include_tax, connected_at) VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, base_url = excluded.base_url, key_enc = excluded.key_enc, secret_enc = excluded.secret_enc,
      prices_include_tax = excluded.prices_include_tax, connected_at = excluded.connected_at`,
    input.kind, baseUrl, await encryptString((await getSecrets(env)).encryptionKey, creds.key), await encryptString((await getSecrets(env)).encryptionKey, creds.secret), creds.pricesIncludeTax ? 1 : 0, now());
  await audit(env.DB, actor, 'shop.connect', 'shop_connection', { kind: input.kind, base_url: baseUrl, prices_include_tax: creds.pricesIncludeTax });
  return (await getConnection(env.DB)) as ConnectionRow;
}

export async function importCatalog(env: Env, actor: Actor) {
  const shop = await requireShop(env.DB);
  const row = await one<ConnectionRow & { key_enc: string; secret_enc: string }>(env.DB, 'SELECT * FROM shop_connection WHERE id = 1');
  if (!row) throw new AppError('NOT_CONNECTED', 'Connect the shop first (connect_shop with a read-only key).', 409);
  const creds = {
    baseUrl: row.base_url,
    key: await decryptString((await getSecrets(env)).encryptionKey, row.key_enc),
    secret: await decryptString((await getSecrets(env)).encryptionKey, row.secret_enc),
    pricesIncludeTax: !!row.prices_include_tax,
  };
  let result;
  try { result = await connectors[row.kind].importCatalog(creds, shop.default_lang); }
  catch (e) { throw new AppError('IMPORT_FAILED', (e as Error).message, 502); }
  if (result.currency !== shop.currency) result.warnings.push(`Shop currency is ${result.currency}; the trade portal invoices in ${shop.currency}.`);
  const stats = await upsertImported(env.DB, actor, row.kind, result.products, await getSettings(env.DB));
  const summary = {
    ...stats, total: result.products.length, languages: result.languages, translation_groups: result.translationGroups,
    currency: result.currency, warnings: result.warnings,
  };
  await run(env.DB, 'UPDATE shop_connection SET last_import_at = ?, last_import_summary = ? WHERE id = 1', now(), JSON.stringify(summary));
  return summary;
}
