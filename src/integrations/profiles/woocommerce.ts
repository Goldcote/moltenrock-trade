// "Hand the order to your WooCommerce shop": a confirmed trade order becomes a normal WooCommerce
// order, so whatever already fulfils the shop's orders (its own warehouse, a 3PL connector, …) ships
// it too. Everything shop-specific — extra order meta, payment method, allowed countries — is a
// setting (woo_handoff), never code. DRY RUN in this version: the payload is built and stored for
// inspection, and nothing is sent (sending needs a scoped write key, added later).

import type { FulfilmentProfile } from '../index';
import type { WooHandoffConfig } from '../../domain/settings';

const money = (rappen: number) => (rappen / 100).toFixed(2);

export function wooOrderProfile(cfg: WooHandoffConfig): FulfilmentProfile {
  return {
    key: 'woocommerce-order',
    label: 'Hand the order to your WooCommerce shop',
    build(order, _partner, shop) {
      const problems: string[] = [];
      if (cfg.allowed_countries.length && !cfg.allowed_countries.includes(order.ship_to.country))
        problems.push(`Shipping country ${order.ship_to.country} is not in woo_handoff.allowed_countries`);
      if (!order.ship_to.street) problems.push('Street (address_1) required');
      if (cfg.require_sku) for (const l of order.lines) if (!l.sku) problems.push(`Line ${l.source_id} has no SKU`);
      if (problems.length) return { problems };

      const address = {
        first_name: order.ship_to.contact, last_name: '', company: order.ship_to.company,
        address_1: `${order.ship_to.street} ${order.ship_to.house_no}`.trim(), address_2: '',
        postcode: order.ship_to.postcode, city: order.ship_to.city, country: order.ship_to.country,
      };
      return {
        target: 'woocommerce',
        method: 'POST',
        path: '/wp-json/wc/v3/orders',
        body: {
          // Created directly in the configured status so order-sync tools that pick up e.g.
          // "processing" orders see it immediately; offline payment method, never charged.
          status: cfg.status,
          set_paid: false,
          payment_method: cfg.payment_method,
          payment_method_title: cfg.payment_method_title,
          customer_id: 0,
          billing: { ...address, email: shop.email },
          shipping: address,
          customer_note: [order.po_number && `PO ${order.po_number}`, order.ref, order.note].filter(Boolean).join(' / '),
          shipping_lines: [order.ship_mode === 'pickup'
            ? { method_id: cfg.pickup_method_id, method_title: 'Pickup', total: '0.00' }
            : { method_id: cfg.delivery_method_id, method_title: 'Delivery', total: '0.00' }],
          line_items: order.lines.map((l) => {
            const isVariation = l.source_id.startsWith('v');
            return {
              product_id: Number(isVariation ? l.parent_source_id : l.source_id),
              ...(isVariation ? { variation_id: Number(l.source_id.slice(1)) } : {}),
              quantity: l.qty,
              subtotal: money(l.line_net_rappen),
              total: money(l.line_net_rappen),
            };
          }),
          meta_data: [
            { key: '_moltentrade_ref', value: order.ref },
            // Lets a small site filter mute WooCommerce's own customer emails for these orders.
            { key: '_moltentrade_silent', value: '1' },
            ...cfg.meta,
          ],
        },
      };
    },
  };
}
