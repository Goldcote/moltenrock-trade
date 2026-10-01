// Shop identity (human-only) and agent-configurable settings (the locked defaults).

import { isLang, LANGS, type Lang } from '../i18n';
import type { Actor } from '../lib/env';
import { AppError } from '../lib/http';
import { isSwissPostcode, isValidIban, isValidUid, normaliseUid, compactIban } from '../swiss/validate';
import { all, audit, now, one, run } from './db';

export interface Shop {
  id: 1;
  legal_name: string;
  street: string;
  house_no: string;
  postcode: string;
  city: string;
  country: string;
  email: string;
  uid: string | null;
  vat_registered: number;
  iban: string | null;
  default_lang: Lang;
  currency: string;
  created_at: number;
}

export const getShop = (db: D1Database) => one<Shop>(db, 'SELECT * FROM shop WHERE id = 1');

export async function requireShop(db: D1Database): Promise<Shop> {
  const s = await getShop(db);
  if (!s) throw new AppError('SHOP_NOT_SET_UP', 'The shop has not been set up yet. A person must complete /merchant/signup first.', 409);
  return s;
}

export const FULFILMENT_PROFILES = ['manual', 'woocommerce-order'] as const;

/** How a confirmed order is handed to the merchant's WooCommerce shop (profile 'woocommerce-order'). */
export interface WooHandoffConfig {
  status: 'processing' | 'on-hold' | 'pending';
  payment_method: string;
  payment_method_title: string;
  meta: { key: string; value: string }[];   // extra order meta the shop's own tools expect
  allowed_countries: string[];              // empty = any
  require_sku: boolean;
  pickup_method_id: string;
  delivery_method_id: string;
}

/** The locked defaults: a first-time merchant can take a first trade order without touching any of these. */
export const DEFAULT_SETTINGS = {
  approval_threshold_rappen: 500_000 as number | null, // decision 1 — CHF 5,000; 0 = hold all; null = never hold
  min_order_rappen: 20_000,                             // decision 2 — CHF 200 net
  payment_terms_days: 14,                               // decision 3 — Net 14
  respect_stock: false,                                 // decision 8 — everything orderable by default
  include_new_products: true,                           // decision 9 — all products orderable by default
  cancel_window_minutes: 30,
  language_fallback: ['de', 'en'] as Lang[],            // storefront never shows an empty product name
  fulfilment_profile: 'manual' as (typeof FULFILMENT_PROFILES)[number], // decision 10 — core has no 3PL code
  woo_handoff: {
    status: 'processing', payment_method: 'bacs', payment_method_title: 'Invoice', meta: [],
    allowed_countries: ['CH'], require_sku: true, pickup_method_id: 'local_pickup', delivery_method_id: 'free_shipping',
  } as WooHandoffConfig,
  defaults_confirmed: false,
  // Legal pages (HUMAN-ONLY, set on Setup): the merchant's own terms/privacy URLs; null = built-in template.
  legal_terms_url: null as string | null,
  legal_privacy_url: null as string | null,
  legal_confirmed: false,
  // Daily check whether a newer MoltenRock Trade version is published (no data sent beyond a normal request).
  update_check: true,
  // Bookkeeping export (journal.csv): Swiss SME chart of accounts by default.
  accounting_accounts: { receivables: '1100', revenue: '3200', vat: '2200', bank: '1020' },
};
export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

/** Settings an agent (or the merchant via their agent) may change. Identity + bank details are NOT here. */
export const AGENT_SETTABLE: SettingKey[] = [
  'approval_threshold_rappen', 'min_order_rappen', 'payment_terms_days', 'respect_stock', 'include_new_products',
  'cancel_window_minutes', 'language_fallback', 'fulfilment_profile', 'woo_handoff', 'update_check', 'accounting_accounts',
];

/** Settings only a signed-in owner changes (on the Setup page); agents can read them, never write them. */
export const OWNER_ONLY_SETTINGS: SettingKey[] = ['legal_terms_url', 'legal_privacy_url', 'legal_confirmed'];

/** Fields only a signed-in human may ever change. Agents get HUMAN_ONLY errors for these. */
export const HUMAN_ONLY_FIELDS = ['legal_name', 'street', 'house_no', 'postcode', 'city', 'country', 'email', 'uid', 'vat_registered', 'iban', 'agent_tokens'];

export async function getSettings(db: D1Database): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) if (r.key in s) (s as Record<string, unknown>)[r.key] = JSON.parse(r.value);
  return s;
}

function validateSetting(key: SettingKey, value: unknown): unknown {
  const intIn = (v: unknown, lo: number, hi: number) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new AppError('INVALID_SETTING', `${key} must be an integer ${lo}–${hi}`);
    return v;
  };
  switch (key) {
    case 'approval_threshold_rappen': return value === null ? null : intIn(value, 0, 100_000_000_00);
    case 'min_order_rappen': return intIn(value, 0, 10_000_000);
    case 'payment_terms_days': return intIn(value, 0, 120);
    case 'cancel_window_minutes': return intIn(value, 0, 24 * 60);
    case 'respect_stock':
    case 'include_new_products':
    case 'defaults_confirmed':
    case 'legal_confirmed':
    case 'update_check':
      if (typeof value !== 'boolean') throw new AppError('INVALID_SETTING', `${key} must be true or false`);
      return value;
    case 'language_fallback': {
      if (!Array.isArray(value) || !value.length || !value.every(isLang)) throw new AppError('INVALID_SETTING', `language_fallback must be a non-empty list of ${LANGS.join(', ')}`);
      return [...new Set(value)];
    }
    case 'fulfilment_profile':
      if (!FULFILMENT_PROFILES.includes(value as never)) throw new AppError('INVALID_SETTING', `fulfilment_profile must be one of ${FULFILMENT_PROFILES.join(', ')}`);
      return value;
    case 'legal_terms_url':
    case 'legal_privacy_url': {
      if (value === null || value === '') return null;
      if (typeof value !== 'string' || value.length > 300 || !/^https:\/\/[^\s<>"]+$/.test(value)) throw new AppError('INVALID_SETTING', `${key} must be an https:// address`);
      return value;
    }
    case 'accounting_accounts': {
      const v = value as Record<string, unknown>;
      const merged = { ...DEFAULT_SETTINGS.accounting_accounts, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) };
      for (const k of ['receivables', 'revenue', 'vat', 'bank'] as const)
        if (typeof merged[k] !== 'string' || !/^[0-9]{3,6}$/.test(merged[k])) throw new AppError('INVALID_SETTING', `accounting_accounts.${k} must be an account number (3–6 digits)`);
      return { receivables: merged.receivables, revenue: merged.revenue, vat: merged.vat, bank: merged.bank };
    }
    case 'woo_handoff': {
      const v = value as Partial<WooHandoffConfig>;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AppError('INVALID_SETTING', 'woo_handoff must be an object');
      const merged = { ...DEFAULT_SETTINGS.woo_handoff, ...v };
      const str = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && s.length <= max;
      if (!['processing', 'on-hold', 'pending'].includes(merged.status)) throw new AppError('INVALID_SETTING', "woo_handoff.status must be 'processing', 'on-hold' or 'pending'");
      if (!str(merged.payment_method, 60) || !str(merged.payment_method_title, 80) || !str(merged.pickup_method_id, 60) || !str(merged.delivery_method_id, 60))
        throw new AppError('INVALID_SETTING', 'woo_handoff payment/shipping method fields must be non-empty strings');
      if (!Array.isArray(merged.meta) || merged.meta.length > 20 || !merged.meta.every((m) => m && str(m.key, 100) && typeof m.value === 'string' && m.value.length <= 500))
        throw new AppError('INVALID_SETTING', 'woo_handoff.meta must be up to 20 {key, value} string pairs');
      if (merged.meta.some((m) => m.key.startsWith('_moltentrade_'))) throw new AppError('INVALID_SETTING', "woo_handoff.meta keys may not start with '_moltentrade_' (reserved)");
      if (!Array.isArray(merged.allowed_countries) || !merged.allowed_countries.every((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)))
        throw new AppError('INVALID_SETTING', 'woo_handoff.allowed_countries must be 2-letter country codes');
      if (typeof merged.require_sku !== 'boolean') throw new AppError('INVALID_SETTING', 'woo_handoff.require_sku must be true or false');
      return merged;
    }
  }
}

/** Update settings. Agents may only touch AGENT_SETTABLE keys; anything else is refused. */
export async function updateSettings(db: D1Database, actor: Actor, patch: Record<string, unknown>): Promise<Settings> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) throw new AppError('NOTHING_TO_UPDATE', 'No settings given.');
  const statements: D1PreparedStatement[] = [];
  const changed: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (HUMAN_ONLY_FIELDS.includes(k)) throw new AppError('HUMAN_ONLY', `'${k}' can only be changed by a person on the merchant page, never by an agent.`, 403);
    const owner = actor.type === 'user' && actor.role === 'owner';
    if (OWNER_ONLY_SETTINGS.includes(k as SettingKey) && !owner) throw new AppError('HUMAN_ONLY', `'${k}' can only be changed by the owner on the Setup page, never by an agent.`, 403);
    const allowed = actor.type === 'agent' ? AGENT_SETTABLE : ([...AGENT_SETTABLE, 'defaults_confirmed', ...(owner ? OWNER_ONLY_SETTINGS : [])] as SettingKey[]);
    if (!allowed.includes(k as SettingKey)) throw new AppError('UNKNOWN_SETTING', `Unknown or read-only setting '${k}'. Settable: ${AGENT_SETTABLE.join(', ')}.`);
    const value = validateSetting(k as SettingKey, v);
    changed[k] = value;
    statements.push(db.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(k, JSON.stringify(value), now(), actor.label));
  }
  await db.batch(statements);
  await audit(db, actor, 'settings.update', 'settings', changed);
  return getSettings(db);
}

export async function confirmDefaults(db: D1Database, actor: Actor): Promise<Settings> {
  await run(db, 'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    'defaults_confirmed', 'true', now(), actor.label);
  await audit(db, actor, 'settings.confirm_defaults');
  return getSettings(db);
}

export interface ShopIdentityInput {
  legal_name: string; street: string; house_no: string; postcode: string; city: string; email: string;
  uid: string; vat_registered: boolean; iban: string; default_lang?: Lang;
}

/** Validate identity + bank details. Only ever called from human-authenticated pages. */
export function validateShopIdentity(i: ShopIdentityInput): ShopIdentityInput {
  const req = ['legal_name', 'street', 'postcode', 'city', 'email', 'iban'] as const;
  for (const k of req) if (!i[k]?.trim()) throw new AppError('REQUIRED', `${k} is required`);
  if (!isSwissPostcode(i.postcode)) throw new AppError('INVALID_POSTCODE', 'Postcode must be a 4-digit Swiss postcode');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email)) throw new AppError('INVALID_EMAIL', 'Invalid email');
  if (!isValidIban(i.iban)) throw new AppError('INVALID_IBAN', 'Invalid CH/LI IBAN');
  if (i.vat_registered && !isValidUid(i.uid)) throw new AppError('INVALID_UID', 'A valid UID (CHE-…) is required when VAT-registered');
  if (i.uid && !isValidUid(i.uid)) throw new AppError('INVALID_UID', 'Invalid UID (check digit)');
  return { ...i, uid: i.uid ? (normaliseUid(i.uid) as string) : '', iban: compactIban(i.iban) };
}

export async function updateShopIdentity(db: D1Database, actor: Actor, input: ShopIdentityInput): Promise<void> {
  if (actor.type !== 'user' || actor.role !== 'owner') throw new AppError('HUMAN_ONLY', 'Only the shop owner can change company and bank details.', 403);
  const v = validateShopIdentity(input);
  await run(db, `UPDATE shop SET legal_name=?, street=?, house_no=?, postcode=?, city=?, email=?, uid=?, vat_registered=?, iban=? WHERE id = 1`,
    v.legal_name, v.street, v.house_no, v.postcode, v.city, v.email, v.uid || null, v.vat_registered ? 1 : 0, v.iban);
  await audit(db, actor, 'shop.update_identity', 'shop', { iban_last4: v.iban.slice(-4), vat_registered: v.vat_registered });
}

export const maskIban = (iban: string | null): string | null => (iban ? `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}` : null);
