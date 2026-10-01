# How trade orders get shipped

MoltenRock Trade has no warehouse code. When a trade order is confirmed and invoiced, the `fulfilment_profile` setting decides what happens next. The agent sets it with `update_settings`, and the status page shows the latest hand-off.

| Profile | What happens | State |
|---|---|---|
| `manual` (default) | The merchant ships from the order list. | working |
| `woocommerce-order` | The order is created in the merchant's own WooCommerce shop. Whatever already ships the shop's orders ships it too: their own team, or a fulfilment partner's connector. | **dry run**: built and shown, never sent |
| Fulfilment partner, direct | A partner's connector receives the order from MoltenRock Trade itself. | planned |

## Through the shop (`woocommerce-order`)

This route makes a fulfilment partner work out of the box. Their connector already picks up the shop's orders, so a trade order that appears in WooCommerce gets shipped with no extra integration.

The partner's connector decides which orders it picks up, for example by status, payment method or an order field. So everything shop-specific is a setting (`woo_handoff`), not code:

| Field | Default | Meaning |
|---|---|---|
| `status` | `processing` | Order status the shop's tools pick up (`processing`, `on-hold` or `pending`) |
| `payment_method` / `payment_method_title` | `bacs` / `Invoice` | An offline method, so nothing is charged; MoltenRock Trade issues the QR-bill |
| `meta` | none | Extra order fields the connector expects, e.g. a B2B marker |
| `allowed_countries` | `["CH"]` | Orders shipping elsewhere are held back (listed as problems) |
| `require_sku` | `true` | Every line needs a SKU (warehouses match on SKU) |
| `pickup_method_id` / `delivery_method_id` | `local_pickup` / `free_shipping` | WooCommerce shipping methods used for pickup and delivery |

MoltenRock Trade always adds `_moltentrade_ref` (the trade order number) and `_moltentrade_silent` (lets the shop mute WooCommerce's own customer emails for these orders, since MoltenRock Trade already sent the confirmation and invoice). Agents can't overwrite these two.

Example, said to the agent: *"Hand confirmed orders to my shop as processing, and add the order field `order_type = B2B`."*

Before this goes live: a write key limited to orders, the email-muting snippet on the shop, and one supervised test order.

## For fulfilment partners and connector makers

Three levels, from no work to full integration:

1. **Works today:** if your connector ships a WooCommerce shop's orders, it ships MoltenRock Trade trade orders too. The merchant just needs the right `woo_handoff` values.
2. **Named preset (next):** tell us which status, payment method and order fields your connector needs. MoltenRock Trade then ships your values as a preset, so the merchant's agent picks "hand to *your connector*" instead of typing field names.
3. **Direct (planned):** your connector receives a signed, versioned order (`moltentrade.order.v1`) over HTTPS, without going through the shop. Changing where order data is sent will always be a decision a person confirms, never the agent alone, because it decides where customer addresses go.
