import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/domain/settings';
import type { Partner } from '../src/domain/partners';
import type { Shop } from '../src/domain/settings';
import type { HandoffOrder } from '../src/integrations';
import { wooOrderProfile } from '../src/integrations/profiles/woocommerce';

const shop = { legal_name: 'Alpenrose Handels AG', email: 'trade@alpenrose.example' } as Shop;
const partner = {} as Partner;
const order: HandoffOrder = {
  ref: 'MT-ABC234', po_number: 'PO-4711', ship_mode: 'delivery', note: '',
  ship_to: { company: 'Hotel Bellevue', contact: 'Anna Muster', street: 'Seestrasse', house_no: '12', postcode: '6006', city: 'Luzern', country: 'CH' },
  lines: [
    { source_id: '101', parent_source_id: null, sku: 'ART-100', qty: 12, line_net_rappen: 21_540 },
    { source_id: 'v205', parent_source_id: '200', sku: 'ART-205', qty: 6, line_net_rappen: 5_010 },
  ],
};
type Built = { target: string; body: Record<string, unknown> & { meta_data: { key: string; value: string }[]; line_items: Record<string, unknown>[] } };

describe('WooCommerce order hand-off', () => {
  it('builds a normal WooCommerce order from the defaults', () => {
    const b = wooOrderProfile(DEFAULT_SETTINGS.woo_handoff).build(order, partner, shop) as Built;
    expect(b.target).toBe('woocommerce');
    expect(b.body).toMatchObject({ status: 'processing', set_paid: false, payment_method: 'bacs', payment_method_title: 'Invoice', customer_note: 'PO PO-4711 / MT-ABC234' });
    expect(b.body.line_items).toEqual([
      { product_id: 101, quantity: 12, subtotal: '215.40', total: '215.40' },
      { product_id: 200, variation_id: 205, quantity: 6, subtotal: '50.10', total: '50.10' },
    ]);
    expect(b.body.meta_data.map((m) => m.key)).toEqual(['_moltentrade_ref', '_moltentrade_silent']);
  });

  it('takes status, payment method and extra meta from settings, not code', () => {
    const cfg = { ...DEFAULT_SETTINGS.woo_handoff, status: 'on-hold' as const, payment_method: 'cod', meta: [{ key: 'order_channel', value: 'trade' }] };
    const b = wooOrderProfile(cfg).build(order, partner, shop) as Built;
    expect(b.body.status).toBe('on-hold');
    expect(b.body.payment_method).toBe('cod');
    expect(b.body.meta_data).toContainEqual({ key: 'order_channel', value: 'trade' });
  });

  it('blocks the hand-off for a country outside allowed_countries or a line without SKU', () => {
    const abroad = { ...order, ship_to: { ...order.ship_to, country: 'DE' } };
    expect(wooOrderProfile(DEFAULT_SETTINGS.woo_handoff).build(abroad, partner, shop)).toEqual({ problems: ['Shipping country DE is not in woo_handoff.allowed_countries'] });
    const noSku: HandoffOrder = { ...order, lines: [{ ...order.lines[0]!, sku: '' }] };
    expect(wooOrderProfile(DEFAULT_SETTINGS.woo_handoff).build(noSku, partner, shop)).toEqual({ problems: ['Line 101 has no SKU'] });
    expect('problems' in wooOrderProfile({ ...DEFAULT_SETTINGS.woo_handoff, allowed_countries: [] }).build(abroad, partner, shop)).toBe(false);
  });
});
