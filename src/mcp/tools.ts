// The agent tool registry. ONE definition per capability drives the MCP server (/mcp), the REST mirror
// (/api/v1/tools/*), the OpenAPI document and /llms.txt — so every surface stays in sync.
// Scopes: read < operate < configure. Trust and money decisions are never tools: agents PROPOSE them.

import { LANGS, type Lang } from '../i18n';
import type { Actor, AgentScope, Env } from '../lib/env';
import { AppError } from '../lib/http';
import { getProduct, listProducts, missingTranslations, setRules, setTranslation, setVisibility, upsertAgentProducts, type AgentProductInput } from '../domain/catalog';
import { connectShop, importCatalog } from '../domain/connection';
import { all } from '../domain/db';
import { displayNumber, getInvoice, listInvoices, markPaid } from '../domain/invoices';
import { getOrder, getOrderByRef, listOrders, orderLines } from '../domain/orders';
import { getPartner, invitePartner, listPartners, setPartnerTerms } from '../domain/partners';
import { createProposal, listProposals } from '../domain/proposals';
import { AGENT_SETTABLE, confirmDefaults, FULFILMENT_PROFILES, getSettings, HUMAN_ONLY_FIELDS, updateSettings } from '../domain/settings';
import { overview, setupStatus, statusLink } from '../domain/status';
import { createTier, listTiers, TIER_TEMPLATES, updateTier } from '../domain/tiers';
import { moltenViewPayload } from '../integrations/moltenview';
import { AGENT_EXPORT_FILES } from '../domain/exports';
import { exportLink } from '../web/exports';
import type { JsonSchema } from './schema';

export interface ToolContext { env: Env; actor: Actor & { type: 'agent' }; baseUrl: string }
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: AgentScope;
  /** Side-effecting tools accept an optional idempotency_key; safe retries return the first result. */
  mutates: boolean;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const id = (description: string): JsonSchema => ({ type: 'integer', minimum: 1, description });
const lang: JsonSchema = { type: 'string', enum: [...LANGS], description: 'Language: de (default), fr, it or en' };
const idem: JsonSchema = { type: 'string', maxLength: 100, description: 'Optional. Reuse the same key to retry safely; the first result is returned again.' };
const reason: JsonSchema = { type: 'string', minLength: 3, maxLength: 500, description: 'Short explanation the owner will read before deciding.' };
const money = (d: string): JsonSchema => ({ type: 'integer', minimum: 0, description: `${d} In rappen (CHF 1.00 = 100).` });

const withKey = (s: JsonSchema): JsonSchema => ({ ...s, properties: { ...s.properties, idempotency_key: idem } });

export const TOOLS: ToolDef[] = [
  // ---------------------------------------------------------------------------------- read
  {
    name: 'get_setup_status', title: 'Setup checklist', scope: 'read', mutates: false,
    description: 'START HERE. Returns the setup checklist and next_action (which tool to call next, or what the human must do). Follow it until ready_to_trade is true and every step is done.',
    inputSchema: obj(), handler: async (_a, c) => setupStatus(c.env, c.baseUrl),
  },
  {
    name: 'get_shop_overview', title: 'Shop overview', scope: 'read', mutates: false,
    description: 'Everything at a glance: shop identity (IBAN masked), settings, tiers, catalogue and translation coverage, partners, orders, open invoices, open proposals, recent agent activity and the latest fulfilment hand-off (dry run). Use it to answer "how is my trade portal doing?".',
    inputSchema: obj(), handler: async (_a, c) => overview(c.env),
  },
  {
    name: 'get_status_page_link', title: 'Status page link for the human', scope: 'read', mutates: false,
    description: 'Returns a signed, read-only link (valid 1 hour) to a status page you can give the owner when they want to SEE the settings and numbers.',
    inputSchema: obj(), handler: async (_a, c) => statusLink(c.env, c.baseUrl),
  },
  {
    name: 'get_export_link', title: 'Download link for the bookkeeping', scope: 'operate', mutates: false,
    description: 'Returns a signed, one-hour download link your human (or their accountant) can open: invoices (invoices + credit notes with VAT per rate and payment status), invoice-lines, customers, or journal (double-entry bookings, Swiss SME chart by default, see accounting_accounts). Period: a year "2026", a quarter "2026-Q3", a month "2026-09" or "all". The complete backup is owner-only on the Exports page, never via a link.',
    inputSchema: obj({ file: { type: 'string', enum: [...AGENT_EXPORT_FILES] }, period: { type: 'string', maxLength: 10, description: '2026 | 2026-Q3 | 2026-09 | all (default: this year)' } }, ['file']),
    handler: async (a, c) => exportLink(c.env, c.baseUrl, a.file as string, a.period as string | undefined),
  },
  {
    name: 'get_moltenview_view', title: 'Live view for MoltenView (Mac)', scope: 'read', mutates: false,
    description: 'Only useful if your human uses the MoltenView app on a Mac and you run on that Mac. Returns a ready view of the portal (what is waiting for their decision, this month\'s confirmed orders, open invoices, latest orders, setup progress). Push the returned `data` unchanged with the moltenview_push tool (or send {"action":"push","data":…} to the MoltenView socket). Call again to refresh.',
    inputSchema: obj(), handler: async (_a, c) => ({ data: await moltenViewPayload(c.env, c.baseUrl), push_with: 'moltenview_push' }),
  },
  {
    name: 'get_settings', title: 'Settings (the 15 defaults)', scope: 'read', mutates: false,
    description: `Current settings with their meaning. Agents may change: ${AGENT_SETTABLE.join(', ')}. Human-only (never changeable by agents): ${HUMAN_ONLY_FIELDS.join(', ')}.`,
    inputSchema: obj(),
    handler: async (_a, c) => ({
      settings: await getSettings(c.env.DB),
      meaning: {
        approval_threshold_rappen: 'Baskets with a NET total strictly greater than this wait for human approval. 0 = hold every basket, null = never hold. Default 500000 (CHF 5,000).',
        min_order_rappen: 'Minimum NET order value. Default 20000 (CHF 200). Partners can have an override.',
        payment_terms_days: 'Invoice due days (Net). Default 14.',
        respect_stock: 'If true, items out of stock in the shop cannot be ordered. Default false (everything orderable).',
        include_new_products: 'If true, newly imported products are offered to trade customers automatically. Default true.',
        cancel_window_minutes: 'Minutes a partner can cancel before the order is confirmed and invoiced. Default 30.',
        language_fallback: 'Order of languages used when a product text is missing. Default ["de","en"].',
        fulfilment_profile: "How confirmed orders are handed on: 'manual' (default: the merchant fulfils from the order list) or 'woocommerce-order' (the order is created in the merchant's WooCommerce shop, so whatever already fulfils shop orders ships it). Dry run in this version: the hand-off is built and shown on the status page, never sent.",
        woo_handoff: "For 'woocommerce-order': the WooCommerce order status (default 'processing'), offline payment method (default 'bacs' titled 'Invoice'), extra order meta the shop's own tools or fulfilment connector expect, allowed shipping countries (default ['CH']), whether every line needs a SKU, and the pickup/delivery shipping method ids. Partial updates are merged with the current values.",
        defaults_confirmed: 'Set by confirm_defaults after the owner has reviewed the defaults.',
        update_check: 'Once a day the portal checks https://moltenrocktrade.com/version.json for a newer MoltenRock Trade (a plain request, no shop data). Default true.',
        accounting_accounts: 'Account numbers used in the bookkeeping journal export: receivables, revenue, vat, bank. Default Swiss SME chart 1100 / 3200 / 2200 / 1020 — ask the owner\'s accountant before changing.',
        legal_terms_url: 'OWNER-ONLY. The merchant\'s own terms page (https), or null for the built-in template at /legal/terms.',
        legal_privacy_url: 'OWNER-ONLY. The merchant\'s own privacy page (https), or null for the built-in template at /legal/privacy.',
        legal_confirmed: 'OWNER-ONLY. True once the owner has reviewed the terms and privacy notice on the Setup page.',
      },
    }),
  },
  { name: 'list_tiers', title: 'Price tiers', scope: 'read', mutates: false, description: 'Price tiers. discount_bp is basis points off the NET price (4000 = 40 %).', inputSchema: obj(), handler: async (_a, c) => listTiers(c.env.DB) },
  { name: 'list_tier_templates', title: 'Tier templates', scope: 'read', mutates: false, description: 'Ready-made generic tiers (Partner −45 %, Distributor −55 %) you can create with create_tier {template}.', inputSchema: obj(), handler: async () => TIER_TEMPLATES },
  {
    name: 'list_products', title: 'List products', scope: 'read', mutates: false,
    description: "Catalogue items with per-language texts (provenance: imported | agent | human), price (raw shop price in rappen), VAT code, inclusion and flags. Products you added with upsert_products have source 'agent', a source_url, and price_confirmed_at (null until the owner confirmed the price; proposed_price_rappen = a changed price waiting). filter: all | orderable | flagged (cannot be priced) | excluded | unconfirmed (prices waiting for the owner). Paginate with cursor.",
    inputSchema: obj({ filter: { type: 'string', enum: ['all', 'orderable', 'flagged', 'excluded', 'unconfirmed'] }, limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: { type: 'integer', minimum: 0 } }),
    handler: async (a, c) => listProducts(c.env.DB, { filter: a.filter as never, limit: (a.limit as number) ?? 50, cursor: a.cursor as number }),
  },
  { name: 'get_product', title: 'Get product', scope: 'read', mutates: false, description: 'One catalogue item with all its language texts.', inputSchema: obj({ product_id: id('Product id') }, ['product_id']),
    handler: async (a, c) => (await getProduct(c.env.DB, a.product_id as number)) ?? notFound('Product') },
  {
    name: 'list_missing_translations', title: 'Missing translations', scope: 'read', mutates: false,
    description: 'Products lacking a name in one or more of DE/FR/IT/EN, each with a reference text to translate from. Fill them with bulk_set_translations.',
    inputSchema: obj({ lang }), handler: async (a, c) => missingTranslations(c.env.DB, a.lang as Lang | undefined),
  },
  { name: 'list_partners', title: 'Trade partners', scope: 'read', mutates: false, description: 'Trade customers. status: pending | approved | rejected | suspended. Pending ones may carry a suggested_template.',
    inputSchema: obj({ status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'suspended'] } }), handler: async (a, c) => listPartners(c.env.DB, a.status as string | undefined) },
  { name: 'get_partner', title: 'Get partner', scope: 'read', mutates: false, description: 'One trade customer.', inputSchema: obj({ partner_id: id('Partner id') }, ['partner_id']),
    handler: async (a, c) => (await getPartner(c.env.DB, a.partner_id as number)) ?? notFound('Partner') },
  { name: 'list_orders', title: 'Orders', scope: 'read', mutates: false, description: 'Orders, newest first. state: awaiting_approval | cancel_window | confirmed | cancelled | rejected.',
    inputSchema: obj({ state: { type: 'string', enum: ['awaiting_approval', 'cancel_window', 'confirmed', 'cancelled', 'rejected'] }, limit: { type: 'integer', minimum: 1, maximum: 200 } }),
    handler: async (a, c) => (await listOrders(c.env.DB, { state: a.state as string, limit: a.limit as number })).map(({ pricing_snapshot: _p, ...o }) => o) },
  {
    name: 'get_order', title: 'Get order', scope: 'read', mutates: false, description: 'One order with its lines and invoice (by order_id or ref such as MT-7F3K9Q).',
    inputSchema: obj({ order_id: id('Order id'), ref: { type: 'string', maxLength: 20 } }),
    handler: async (a, c) => {
      const o = a.order_id ? await getOrder(c.env.DB, a.order_id as number) : a.ref ? await getOrderByRef(c.env.DB, a.ref as string) : null;
      if (!o) return notFound('Order');
      const { pricing_snapshot: _p, ...rest } = o;
      const invs = await listInvoices(c.env.DB, { orderId: o.id });
      return { ...rest, ship_to: JSON.parse(o.ship_to), lines: await orderLines(c.env.DB, o.id), invoices: invs.map((i) => ({ id: i.id, number: displayNumber(i), kind: i.kind, status: i.status, total_rappen: i.total_rappen, due_date: i.due_date })) };
    },
  },
  { name: 'list_invoices', title: 'Invoices', scope: 'read', mutates: false, description: 'Invoices and credit notes. status: open | paid | credited | issued (credit notes).',
    inputSchema: obj({ status: { type: 'string', enum: ['open', 'paid', 'credited', 'issued'] } }),
    handler: async (a, c) => (await listInvoices(c.env.DB, { status: a.status as string })).map((i) => ({ ...i, display_number: displayNumber(i), vat_breakdown: JSON.parse(i.vat_breakdown) })) },
  { name: 'list_proposals', title: 'Proposals', scope: 'read', mutates: false, description: 'Your proposals and their outcome. status: open | confirmed | rejected | superseded.',
    inputSchema: obj({ status: { type: 'string', enum: ['open', 'confirmed', 'rejected', 'superseded'] } }), handler: async (a, c) => listProposals(c.env.DB, (a.status as string) ?? 'open') },
  { name: 'get_audit_log', title: 'Audit log', scope: 'read', mutates: false, description: 'Append-only log of who (person, partner or agent) did what.',
    inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 200 } }), handler: async (a, c) => all(c.env.DB, 'SELECT at, actor_type, actor_label, action, target, detail FROM audit_log ORDER BY id DESC LIMIT ?', (a.limit as number) ?? 50) },

  // ---------------------------------------------------------------------------------- operate
  {
    name: 'invite_partner', title: 'Invite a trade customer', scope: 'operate', mutates: true,
    description: 'Open an account for a trade customer the owner knows. Invited partners are approved immediately (default tier Standard unless tier_id is given) and receive a sign-in link by email.',
    inputSchema: withKey(obj({
      company: { type: 'string', maxLength: 120 }, contact_name: { type: 'string', maxLength: 120 }, email: { type: 'string', maxLength: 200 },
      phone: { type: 'string', maxLength: 40 }, street: { type: 'string', maxLength: 70 }, house_no: { type: 'string', maxLength: 16 },
      postcode: { type: 'string', maxLength: 4, description: 'Swiss 4-digit postcode' }, city: { type: 'string', maxLength: 35 },
      uid: { type: 'string', maxLength: 25, description: 'Optional CHE-123.456.789' }, language: lang, business_type: { type: 'string', enum: ['retail', 'hotel', 'pharmacy', 'salon', 'other'] },
      tier_id: id('Optional tier id'),
    }, ['company', 'contact_name', 'email', 'street', 'postcode', 'city'])),
    handler: async (a, c) => invitePartner(c.env, c.actor, a as never, c.baseUrl),
  },
  {
    name: 'propose_partner_decision', title: 'Propose approving/rejecting/suspending a partner', scope: 'operate', mutates: true,
    description: 'Partner approvals are a HUMAN decision. This files a proposal the owner confirms or rejects on the Approvals page. Include a tier_id when proposing approval.',
    inputSchema: withKey(obj({ partner_id: id('Partner id'), decision: { type: 'string', enum: ['approve', 'reject', 'suspend'] }, tier_id: id('Tier for approval'), reason }, ['partner_id', 'decision', 'reason'])),
    handler: async (a, c) => createProposal(c.env, c.actor, 'partner_decision', a.partner_id as number, { decision: a.decision, tier_id: a.tier_id }, a.reason as string),
  },
  {
    name: 'propose_basket_decision', title: 'Propose approving/rejecting a held order', scope: 'operate', mutates: true,
    description: 'Orders above the approval threshold wait for a HUMAN. This files a proposal (with your reasoning) that the owner confirms on the Approvals page.',
    inputSchema: withKey(obj({ order_id: id('Order id (state awaiting_approval)'), decision: { type: 'string', enum: ['approve', 'reject'] }, reason }, ['order_id', 'decision', 'reason'])),
    handler: async (a, c) => createProposal(c.env, c.actor, 'basket_decision', a.order_id as number, { decision: a.decision }, a.reason as string),
  },
  {
    name: 'propose_credit_note', title: 'Propose a credit note', scope: 'operate', mutates: true,
    description: 'Invoices are corrected only by a full credit note, issued by a HUMAN. This files the proposal.',
    inputSchema: withKey(obj({ invoice_id: id('Invoice id'), reason }, ['invoice_id', 'reason'])),
    handler: async (a, c) => createProposal(c.env, c.actor, 'credit_note', a.invoice_id as number, {}, a.reason as string),
  },
  {
    name: 'mark_invoice_paid', title: 'Record a payment', scope: 'operate', mutates: true,
    description: 'Mark an open invoice as paid (e.g. after matching a bank statement line to its QR reference). No money moves; this only records it.',
    inputSchema: withKey(obj({ invoice_id: id('Invoice id'), paid_on: { type: 'string', maxLength: 10, description: 'YYYY-MM-DD, default today' } }, ['invoice_id'])),
    handler: async (a, c) => markPaid(c.env, c.actor, a.invoice_id as number, a.paid_on as string | undefined),
  },

  // ---------------------------------------------------------------------------------- configure
  {
    name: 'connect_shop', title: 'Connect the existing shop (read-only key)', scope: 'configure', mutates: true,
    description: 'Connect the merchant\'s WooCommerce shop with a READ-ONLY REST key (WooCommerce → Settings → Advanced → REST API → Permissions "Read"). The key is tested, then stored encrypted. MoltenRock Trade never writes to the shop.',
    inputSchema: withKey(obj({
      kind: { type: 'string', enum: ['woocommerce', 'shopify'] }, base_url: { type: 'string', maxLength: 200, description: 'e.g. https://shop.example.ch' },
      consumer_key: { type: 'string', maxLength: 200 }, consumer_secret: { type: 'string', maxLength: 200 },
      prices_include_tax: { type: 'boolean', description: 'Are shop prices entered including VAT? Swiss B2C shops usually: true.' },
    }, ['kind', 'base_url', 'consumer_key', 'consumer_secret'])),
    handler: async (a, c) => connectShop(c.env, c.actor, a as never),
  },
  {
    name: 'import_catalog', title: 'Import the catalogue', scope: 'configure', mutates: true,
    description: 'Read the shop catalogue (GET only). Polylang/WPML translations become one product with several languages. Items without a usable price are flagged and excluded. Re-running updates prices and keeps your translations and choices.',
    inputSchema: withKey(obj()), handler: async (_a, c) => importCatalog(c.env, c.actor),
  },
  {
    name: 'upsert_products', title: 'Add or update products (any shop, website or spreadsheet)', scope: 'configure', mutates: true,
    description: 'For shops that are NOT WooCommerce (Shopify, Wix, Squarespace, a custom website), a spreadsheet the owner gives you, or a product feed: read the products yourself and add them here, up to 100 per call. Re-send the same source_id to update. Use the product page URL (or the SKU) as source_id and send source_url so the owner can check where a price came from. price_rappen is the price exactly as shown (CHF 12.50 = 1250); prices_include_tax is true for normal shop prices (default). Leave price_rappen out if you could not find a price: the item is set aside. IMPORTANT: prices you add only become orderable once the owner confirms them under Approvals → Prices to confirm; if you send a different price for a confirmed product, the confirmed price stays in force until the owner confirms the new one. Never invent prices. Texts: give a name in at least one language; the other languages can follow with bulk_set_translations.',
    inputSchema: withKey(obj({
      products: { type: 'array', minItems: 1, maxItems: 100, items: obj({
        source_id: { type: 'string', maxLength: 300, description: 'Stable key: product page URL or SKU' },
        parent_source_id: { type: ['string', 'null'], maxLength: 300, description: 'Variants: source_id of the parent product' },
        sku: { type: 'string', maxLength: 100 }, source_url: { type: 'string', maxLength: 500, description: 'https:// page where you found it' },
        price_rappen: { type: ['integer', 'null'], minimum: 0, maximum: 100000000, description: 'Price as shown, in rappen (CHF 12.50 = 1250)' },
        prices_include_tax: { type: 'boolean', description: 'Default true (shop prices include VAT)' },
        vat_code: { type: 'string', enum: ['standard', 'reduced', 'accommodation', 'zero'], description: 'standard 8.1 % (default), reduced 2.6 % (food, books, medicines), accommodation 3.8 %, zero' },
        image_url: { type: 'string', maxLength: 500 }, in_stock: { type: 'boolean' },
        texts: { type: 'object', additionalProperties: false, properties: Object.fromEntries(LANGS.map((l) => [l, obj({ name: { type: 'string', maxLength: 200 }, short_desc: { type: 'string', maxLength: 1000 }, description: { type: 'string', maxLength: 10000 } }, ['name'])])) },
      }, ['source_id', 'texts']) },
    }, ['products'])),
    handler: async (a, c) => upsertAgentProducts(c.env.DB, c.actor, a.products as AgentProductInput[], await getSettings(c.env.DB)),
  },
  {
    name: 'set_product_translation', title: 'Write product text in one language', scope: 'configure', mutates: true,
    description: 'Set the name and texts of a product in one language (recorded as provenance "agent"). Write natural, market-appropriate Swiss copy; DE-CH uses "ss", never "ß".',
    inputSchema: withKey(obj({ product_id: id('Product id'), lang, name: { type: 'string', maxLength: 200 }, short_desc: { type: 'string', maxLength: 1000 }, description: { type: 'string', maxLength: 10000 }, unit_text: { type: 'string', maxLength: 80, description: 'e.g. "Tube 100 ml"' } }, ['product_id', 'lang', 'name'])),
    handler: async (a, c) => setTranslation(c.env.DB, c.actor, a as never),
  },
  {
    name: 'bulk_set_translations', title: 'Write many product texts', scope: 'configure', mutates: true,
    description: 'Same as set_product_translation for up to 200 items at once. Returns per-item results.',
    inputSchema: withKey(obj({ items: { type: 'array', minItems: 1, maxItems: 200, items: obj({ product_id: id('Product id'), lang, name: { type: 'string', maxLength: 200 }, short_desc: { type: 'string', maxLength: 1000 }, description: { type: 'string', maxLength: 10000 }, unit_text: { type: 'string', maxLength: 80 } }, ['product_id', 'lang', 'name']) } }, ['items'])),
    handler: async (a, c) => {
      const results = [];
      for (const item of a.items as Record<string, unknown>[]) {
        try { await setTranslation(c.env.DB, c.actor, item as never); results.push({ product_id: item.product_id, lang: item.lang, ok: true }); }
        catch (e) { results.push({ product_id: item.product_id, lang: item.lang, ok: false, error: (e as Error).message }); }
      }
      return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
    },
  },
  {
    name: 'set_product_visibility', title: 'Offer or hide products', scope: 'configure', mutates: true,
    description: 'Include or exclude products for trade customers. Unpriceable (flagged) items cannot be included.',
    inputSchema: withKey(obj({ product_ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'integer', minimum: 1 } }, included: { type: 'boolean' } }, ['product_ids', 'included'])),
    handler: async (a, c) => setVisibility(c.env.DB, c.actor, a.product_ids as number[], a.included as boolean),
  },
  {
    name: 'set_product_rules', title: 'Carton size and minimum quantity', scope: 'configure', mutates: true,
    description: 'Optional per-product ordering rules. carton_multiple: quantities must be a multiple of it (null = any). min_qty: minimum per line (null = 1).',
    inputSchema: withKey(obj({ product_id: id('Product id'), carton_multiple: { type: ['integer', 'null'], minimum: 1, maximum: 999 }, min_qty: { type: ['integer', 'null'], minimum: 1, maximum: 999 } }, ['product_id'])),
    handler: async (a, c) => setRules(c.env.DB, c.actor, a.product_id as number, a as never),
  },
  {
    name: 'update_settings', title: 'Change settings', scope: 'configure', mutates: true,
    description: `Change any of: ${AGENT_SETTABLE.join(', ')}. Company identity, VAT number and bank details are HUMAN_ONLY and will be refused.`,
    inputSchema: withKey({
      type: 'object', additionalProperties: true,
      properties: {
        approval_threshold_rappen: { type: ['integer', 'null'], minimum: 0, description: 'NET basket above which a human approves. 0 = all, null = never.' },
        min_order_rappen: money('Minimum NET order value.'), payment_terms_days: { type: 'integer', minimum: 0, maximum: 120 },
        respect_stock: { type: 'boolean' }, include_new_products: { type: 'boolean' }, cancel_window_minutes: { type: 'integer', minimum: 0, maximum: 1440 },
        language_fallback: { type: 'array', minItems: 1, maxItems: 4, items: lang }, fulfilment_profile: { type: 'string', enum: [...FULFILMENT_PROFILES] },
        update_check: { type: 'boolean' },
        accounting_accounts: obj({ receivables: { type: 'string', maxLength: 6 }, revenue: { type: 'string', maxLength: 6 }, vat: { type: 'string', maxLength: 6 }, bank: { type: 'string', maxLength: 6 } }),
        woo_handoff: {
          type: 'object', additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['processing', 'on-hold', 'pending'] },
            payment_method: { type: 'string', maxLength: 60 }, payment_method_title: { type: 'string', maxLength: 80 },
            meta: { type: 'array', maxItems: 20, items: obj({ key: { type: 'string', maxLength: 100 }, value: { type: 'string', maxLength: 500 } }, ['key', 'value']) },
            allowed_countries: { type: 'array', maxItems: 60, items: { type: 'string', maxLength: 2 } },
            require_sku: { type: 'boolean' }, pickup_method_id: { type: 'string', maxLength: 60 }, delivery_method_id: { type: 'string', maxLength: 60 },
          },
        },
      },
    }),
    handler: async (a, c) => { const { idempotency_key: _k, ...patch } = a; return updateSettings(c.env.DB, c.actor, patch); },
  },
  {
    name: 'confirm_defaults', title: 'Confirm the defaults', scope: 'configure', mutates: true,
    description: 'Call after walking the owner through get_settings (and changing anything they wanted). Marks the setup step done.',
    inputSchema: withKey(obj()), handler: async (_a, c) => confirmDefaults(c.env.DB, c.actor),
  },
  {
    name: 'create_tier', title: 'Create a price tier', scope: 'configure', mutates: true,
    description: 'Create a custom tier (name + discount_bp) or from a template (e.g. template "partner" = −45 %).',
    inputSchema: withKey(obj({ name: { type: 'string', maxLength: 60 }, discount_bp: { type: 'integer', minimum: 0, maximum: 9900 }, template: { type: 'string', enum: TIER_TEMPLATES.map((t) => t.key) } })),
    handler: async (a, c) => createTier(c.env.DB, c.actor, a as never),
  },
  {
    name: 'update_tier', title: 'Edit a price tier', scope: 'configure', mutates: true, description: 'Rename a tier, change its discount, or make it the default for new partners.',
    inputSchema: withKey(obj({ tier_id: id('Tier id'), name: { type: 'string', maxLength: 60 }, discount_bp: { type: 'integer', minimum: 0, maximum: 9900 }, is_default: { type: 'boolean' } }, ['tier_id'])),
    handler: async (a, c) => updateTier(c.env.DB, c.actor, a.tier_id as number, a as never),
  },
  {
    name: 'set_partner_terms', title: 'Set a partner\'s commercial terms', scope: 'configure', mutates: true,
    description: 'Assign a tier and optional per-partner overrides (minimum order, payment days). Use null to fall back to the shop default.',
    inputSchema: withKey(obj({ partner_id: id('Partner id'), tier_id: id('Tier id'), min_order_rappen: { type: ['integer', 'null'], minimum: 0 }, payment_terms_days: { type: ['integer', 'null'], minimum: 0, maximum: 120 } }, ['partner_id'])),
    handler: async (a, c) => setPartnerTerms(c.env.DB, c.actor, a.partner_id as number, a as never),
  },
];

function notFound(what: string): never {
  throw new AppError('NOT_FOUND', `${what} not found`, 404);
}

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
export { getInvoice };
