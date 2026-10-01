// Setup checklist (what an agent should do next) and the read-only status snapshot shown on the
// status page, returned by get_shop_overview, and (later) pushed to MoltenView.

import { LANGS } from '../i18n';
import type { Env } from '../lib/env';
import { hmacHex, safeEqual } from '../lib/crypto';
import { getSecrets } from '../lib/bootstrap';
import { latestHandoff } from '../integrations';
import { ORDERABLE_SQL, translationCoverage, UNCONFIRMED_SQL } from './catalog';
import { getConnection } from './connection';
import { all, emailConfigured, now, one } from './db';
import { listProposals } from './proposals';
import { getSettings, getShop, maskIban } from './settings';
import { listTiers } from './tiers';
import { listAgentTokens } from './tokens';

type Step = { id: string; done: boolean; who: 'human' | 'agent'; title: string; detail?: string; tool?: string; hint?: string; optional?: boolean };

export async function setupStatus(env: Env, baseUrl: string) {
  const shop = await getShop(env.DB);
  const settings = await getSettings(env.DB);
  const conn = await getConnection(env.DB);
  const counts = await one<{ total: number; orderable: number; flagged: number; agent_added: number; unconfirmed: number }>(env.DB,
    `SELECT COUNT(*) AS total, SUM(CASE WHEN ${ORDERABLE_SQL} THEN 1 ELSE 0 END) AS orderable, SUM(unpriceable) AS flagged,
            SUM(CASE WHEN source = 'agent' THEN 1 ELSE 0 END) AS agent_added, SUM(CASE WHEN ${UNCONFIRMED_SQL} THEN 1 ELSE 0 END) AS unconfirmed FROM products`);
  const cov = await translationCoverage(env.DB);
  const missingByLang = Object.fromEntries(LANGS.map((l) => [l, Math.max(0, cov.products - cov.by_lang[l].present)]));
  const missingTotal = Object.values(missingByLang).reduce((a, b) => a + b, 0);
  const approvedPartners = (await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM partners WHERE status = 'approved'"))?.n ?? 0;

  const steps: Step[] = [
    { id: 'shop_details', who: 'human', done: !!shop, title: 'Company details and bank account (human-only)', hint: `A person completes ${baseUrl}/merchant/signup` },
    { id: 'connect_shop', who: 'agent', done: !!conn || (counts?.agent_added ?? 0) > 0, title: 'Get the products: connect a WooCommerce shop with a READ-ONLY key, or — any other shop — read the products yourself', tool: 'connect_shop',
      hint: 'Ask the owner which shop system they use. WooCommerce: ask for a read-only REST key (WooCommerce → Settings → Advanced → REST API → Permissions: Read), then connect_shop + import_catalog. Shopify, Wix, Squarespace, a custom website, a spreadsheet or a product feed: read the products yourself (website pages, the file they give you) and add them with upsert_products, including source_url. Never invent prices.' },
    { id: 'import_catalog', who: 'agent', done: (counts?.total ?? 0) > 0, title: 'Import the catalogue (or add it with upsert_products)', tool: 'import_catalog' },
    { id: 'confirm_prices', who: 'human', done: (counts?.unconfirmed ?? 0) === 0, title: 'Prices you found on the website confirmed by the owner (human-only)',
      detail: `${counts?.unconfirmed ?? 0} waiting`, hint: `Ask your human to check and confirm the prices you added under Approvals → Prices to confirm (${baseUrl}/merchant/approvals#prices). Until then those products are not orderable.` },
    { id: 'review_flagged', who: 'agent', done: (counts?.total ?? 0) > 0, title: 'Review items that cannot be priced (excluded by default)', tool: 'list_products',
      detail: `${counts?.flagged ?? 0} flagged`, hint: "list_products with filter 'flagged'; they stay excluded until fixed in the shop (WooCommerce) — or, for products you added with upsert_products, until you find the real price and send them again." },
    { id: 'translations', who: 'agent', done: (counts?.total ?? 0) > 0 && missingTotal === 0, title: 'Complete product texts in DE, FR, IT and EN', tool: 'list_missing_translations',
      detail: Object.entries(missingByLang).filter(([, n]) => n > 0).map(([l, n]) => `${l.toUpperCase()} ${n} missing`).join(' · ') || 'complete', hint: 'Write natural Swiss copy (DE-CH uses "ss", not "ß"). Use bulk_set_translations.' },
    { id: 'confirm_defaults', who: 'agent', done: settings.defaults_confirmed, title: 'Review the 15 defaults with the owner, then confirm', tool: 'confirm_defaults',
      hint: 'get_settings shows them; change any with update_settings; then confirm_defaults.' },
    { id: 'legal', who: 'human', done: settings.legal_confirmed, title: 'Terms and privacy notice confirmed by the owner (human-only)',
      hint: `Ask your human to review the terms and privacy notice under Setup → "Before your first trade customer" (${baseUrl}/merchant/setup#legal): built-in templates or links to their own pages.` },
    { id: 'first_partner', who: 'agent', done: approvedPartners > 0, title: 'Invite the first trade customer', tool: 'invite_partner' },
    { id: 'email', who: 'human', optional: true, done: emailConfigured(env), title: 'Email sending set up (recommended, human-only)',
      hint: `Without email, trade customers cannot sign in by themselves. Your human sets it up once (Resend + two Cloudflare variables): ${baseUrl}/merchant/setup#email` },
  ];
  const next = steps.find((s) => !s.done && !s.optional) ?? null;
  return {
    ready_to_trade: !!shop && !!shop.iban && (counts?.orderable ?? 0) > 0,
    facts: { flagged: counts?.flagged ?? 0, missing_by_lang: missingByLang, unconfirmed_prices: counts?.unconfirmed ?? 0 },
    steps,
    next_action: next ? { step: next.id, who: next.who, tool: next.tool ?? null, hint: next.hint ?? next.title } : null,
  };
}

export async function overview(env: Env) {
  const [shop, settings, conn, tiers, tokens, proposals] = await Promise.all([
    getShop(env.DB), getSettings(env.DB), getConnection(env.DB), listTiers(env.DB), listAgentTokens(env.DB), listProposals(env.DB),
  ]);
  const catalog = await one<{ total: number; orderable: number; flagged: number; excluded: number }>(env.DB,
    `SELECT COUNT(*) AS total, SUM(CASE WHEN ${ORDERABLE_SQL} THEN 1 ELSE 0 END) AS orderable, SUM(unpriceable) AS flagged, SUM(CASE WHEN included = 0 THEN 1 ELSE 0 END) AS excluded FROM products`);
  const partners = await all<{ status: string; n: number }>(env.DB, 'SELECT status, COUNT(*) AS n FROM partners GROUP BY status');
  const orders = await all<{ state: string; n: number; total: number }>(env.DB, 'SELECT state, COUNT(*) AS n, SUM(total_rappen) AS total FROM orders GROUP BY state');
  const recentOrders = await all(env.DB, 'SELECT o.ref, o.state, o.total_rappen, o.created_at, p.company FROM orders o JOIN partners p ON p.id = o.partner_id ORDER BY o.id DESC LIMIT 10');
  const invoices = await one<{ open_n: number; open_total: number; overdue_n: number; paid_n: number }>(env.DB,
    `SELECT SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_n, SUM(CASE WHEN status = 'open' THEN total_rappen ELSE 0 END) AS open_total,
            SUM(CASE WHEN status = 'open' AND due_date < date('now') THEN 1 ELSE 0 END) AS overdue_n, SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_n
     FROM invoices WHERE kind = 'invoice'`);
  const agentActivity = await all(env.DB, "SELECT at, actor_label, action, target FROM audit_log WHERE actor_type = 'agent' ORDER BY id DESC LIMIT 20");
  const handoff = await latestHandoff(env.DB);
  return {
    shop: shop && {
      legal_name: shop.legal_name, city: shop.city, email: shop.email, uid: shop.uid, vat_registered: !!shop.vat_registered,
      iban: maskIban(shop.iban), default_lang: shop.default_lang, currency: shop.currency,
    },
    settings,
    tiers,
    shop_connection: conn && { kind: conn.kind, base_url: conn.base_url, prices_include_tax: !!conn.prices_include_tax, last_import_at: conn.last_import_at, last_import: conn.last_import_summary ? JSON.parse(conn.last_import_summary) : null },
    catalog: { ...catalog, translations: await translationCoverage(env.DB) },
    partners: Object.fromEntries(partners.map((p) => [p.status, p.n])),
    orders: Object.fromEntries(orders.map((o) => [o.state, { count: o.n, total_rappen: o.total }])),
    recent_orders: recentOrders,
    invoices,
    open_proposals: proposals.length,
    agent_tokens: tokens.map((t) => ({ name: t.name, scope: t.scope, last_used_at: t.last_used_at, revoked: !!t.revoked_at })),
    recent_agent_activity: agentActivity,
    latest_fulfilment_handoff: handoff && { ...handoff, payload: JSON.parse(handoff.payload), note: 'DRY RUN — built for inspection, never sent' },
  };
}

const STATUS_TTL = 60 * 60 * 1000;

/** A signed, read-only, one-hour link to the status page (what an agent hands to its human). */
export async function statusLink(env: Env, baseUrl: string): Promise<{ url: string; expires_at: number }> {
  const exp = now() + STATUS_TTL;
  const sig = await hmacHex((await getSecrets(env)).sessionSecret, `status:${exp}`);
  return { url: `${baseUrl}/status?exp=${exp}&sig=${sig}`, expires_at: exp };
}

export async function verifyStatusLink(env: Env, url: URL): Promise<boolean> {
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') ?? '';
  if (!exp || exp < now() || exp > now() + STATUS_TTL + 60_000) return false;
  return safeEqual(sig, await hmacHex((await getSecrets(env)).sessionSecret, `status:${exp}`));
}
