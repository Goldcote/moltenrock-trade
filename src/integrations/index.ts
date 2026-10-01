// Fulfilment integrations (decision 10). The core has no warehouse/3PL code: a confirmed order is
// either handled manually by the merchant or handed to a profile. In this prototype every hand-off is a
// DRY RUN — the payload is built and stored for inspection, and nothing is ever sent.

import type { Env } from '../lib/env';
import { now, one, run } from '../domain/db';
import type { Partner } from '../domain/partners';
import type { Settings, Shop } from '../domain/settings';
import { wooOrderProfile } from './profiles/woocommerce';

export interface HandoffOrder {
  ref: string; po_number: string; ship_mode: 'delivery' | 'pickup'; note: string;
  ship_to: { company: string; contact: string; street: string; house_no: string; postcode: string; city: string; country: string };
  lines: { source_id: string; parent_source_id: string | null; sku: string; qty: number; line_net_rappen: number }[];
}

export interface FulfilmentProfile {
  key: string;
  label: string;
  /** Returns the request the hand-off WOULD make, or problems that block it. */
  build(order: HandoffOrder, partner: Partner, shop: Shop): { target: string; method: 'POST'; path: string; body: unknown } | { problems: string[] };
}

/**
 * The fulfilment slot. Built in: 'manual' (the merchant fulfils from the order list) and
 * 'woocommerce-order' (the order goes into the merchant's shop, so whatever already fulfils the
 * shop's orders — its own team or a 3PL connector — ships it too). A fulfilment partner's own
 * connector plugs in here as a further profile; see docs/FULFILMENT.md.
 */
function profileFor(settings: Settings): FulfilmentProfile | null {
  if (settings.fulfilment_profile === 'woocommerce-order') return wooOrderProfile(settings.woo_handoff);
  return null;
}

export async function recordHandoff(env: Env, settings: Settings, orderId: number, order: HandoffOrder, partner: Partner, shop: Shop): Promise<void> {
  const profile = profileFor(settings);
  if (!profile) return; // 'manual'
  const built = profile.build(order, partner, shop);
  await run(env.DB, "INSERT INTO integration_outbox (order_id, profile, target, payload, status, created_at) VALUES (?, ?, ?, ?, 'dry_run', ?)",
    orderId, profile.key, 'target' in built ? built.target : 'blocked', JSON.stringify(built), now());
}

export const latestHandoff = (db: D1Database) =>
  one<{ order_id: number; profile: string; target: string; payload: string; status: string; created_at: number }>(db, 'SELECT * FROM integration_outbox ORDER BY id DESC LIMIT 1');
