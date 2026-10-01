// LOCAL DEMO DATA (DEV=1 only): twelve weeks of plausible Swiss trade — hotels, pharmacies, spas
// and shops ordering the imported catalogue — so the dashboard can be seen with real-looking life.
// Uses the real pricing code; fictional companies; never available on a deployed portal.

import type { Env } from '../lib/env';
import { AppError } from '../lib/http';
import { addDaysISO, isoDate } from '../money/format';
import { lineNetRappen, totals, unitNetRappen } from '../money/pricing';
import { all, now, one, run } from '../domain/db';
import { getSettings, requireShop } from '../domain/settings';
import { upsertAgentProducts, type AgentProductInput } from '../domain/catalog';
import type { Actor } from '../lib/env';
import { isQrIban, makeQrr, makeScor } from '../swiss/validate';

const DAY = 86_400_000;

const COMPANIES = [
  { company: 'Hotel Alpenblick AG', contact: 'Reto Brunner', city: 'Grindelwald', postcode: '3818', street: 'Dorfstrasse', lang: 'de', type: 'hotel', vip: true },
  { company: 'Farmacia Centrale SA', contact: 'Giulia Bernasconi', city: 'Lugano', postcode: '6900', street: 'Via Nassa', lang: 'it', type: 'pharmacy', vip: false },
  { company: 'Boutique Léman Sàrl', contact: 'Camille Favre', city: 'Genève', postcode: '1204', street: 'Rue du Rhône', lang: 'fr', type: 'retail', vip: false },
  { company: 'Berghaus Engadin AG', contact: 'Men Pünchera', city: 'St. Moritz', postcode: '7500', street: 'Via Serlas', lang: 'de', type: 'hotel', vip: true },
  { company: 'Apotheke am Rhein AG', contact: 'Sabine Keller', city: 'Basel', postcode: '4051', street: 'Rheinsprung', lang: 'de', type: 'pharmacy', vip: false },
  { company: 'Spa Lago Maggiore SA', contact: 'Luca Pedrazzini', city: 'Locarno', postcode: '6600', street: 'Lungolago', lang: 'it', type: 'salon', vip: false },
  { company: 'Drogerie Seefeld GmbH', contact: 'Martin Huber', city: 'Zürich', postcode: '8008', street: 'Seefeldstrasse', lang: 'de', type: 'pharmacy', vip: false },
  { company: 'Wellnesshotel Aare AG', contact: 'Andrea Zbinden', city: 'Bern', postcode: '3011', street: 'Aarstrasse', lang: 'de', type: 'hotel', vip: false },
  { company: 'Surf & Sun Shop GmbH', contact: 'Nina Meier', city: 'Luzern', postcode: '6004', street: 'Haldenstrasse', lang: 'de', type: 'retail', vip: false },
];
const APPLICANTS = [
  { company: 'Camping Bella Vista SA', contact: 'Marco Rossi', city: 'Tenero', postcode: '6598', street: 'Via Brere', lang: 'it', type: 'other' },
  { company: 'Hôtel des Alpes Sàrl', contact: 'Julien Rochat', city: 'Champéry', postcode: '1874', street: 'Rue du Village', lang: 'fr', type: 'hotel' },
];

/** Tiny deterministic PRNG so the demo looks the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export async function seedDemo(env: Env): Promise<{ partners: number; orders: number; invoices: number }> {
  if (await one(env.DB, "SELECT 1 FROM partners WHERE email LIKE 'demo+%@example.test'")) throw new AppError('ALREADY', 'Demo data is already there.', 409);
  const shop = await requireShop(env.DB);
  const products = await all<{ id: number; source_id: string; sku: string; price_rappen: number; prices_include_tax: number; vat_code: string; name: string | null }>(env.DB,
    `SELECT p.id, p.source_id, p.sku, p.price_rappen, p.prices_include_tax, p.vat_code,
            (SELECT name FROM product_translations t WHERE t.product_id = p.id AND t.lang = 'de') AS name
     FROM products p WHERE p.included = 1 AND p.unpriceable = 0 ORDER BY p.id`);
  if (products.length < 3) throw new AppError('NO_CATALOGUE', 'Import a catalogue first (the agent does this).', 409);
  const tiers = await all<{ id: number; name: string; discount_bp: number; is_default: number }>(env.DB, 'SELECT id, name, discount_bp, is_default FROM tiers ORDER BY discount_bp');
  const std = tiers.find((t) => t.is_default) ?? tiers[0]!;
  const vip = tiers.find((t) => /vip/i.test(t.name)) ?? tiers[tiers.length - 1]!;
  const RATE: Record<string, number> = { standard: 810, reduced: 260, accommodation: 380, zero: 0 };
  const rand = rng(1770);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const t0 = now();

  // Partners (+ one sign-in user each) and two open applications.
  const partners: { id: number; userId: number; c: (typeof COMPANIES)[number]; tier: typeof std }[] = [];
  for (const [i, c] of COMPANIES.entries()) {
    const tier = c.vip ? vip : std;
    const email = `demo+${i + 1}@example.test`;
    const created = t0 - (95 - i * 3) * DAY;
    const res = await run(env.DB, `INSERT INTO partners (company, contact_name, email, street, house_no, postcode, city, country, language, business_type, tier_id, status, invited, created_at, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CH', ?, ?, ?, 'approved', 1, ?, ?)`, c.company, c.contact, email, c.street, String(3 + i * 7), c.postcode, c.city, c.lang, c.type, tier.id, created, created);
    const pid = Number(res.meta.last_row_id);
    const u = await run(env.DB, 'INSERT INTO partner_users (partner_id, email, name, created_at) VALUES (?, ?, ?, ?)', pid, email, c.contact, created);
    partners.push({ id: pid, userId: Number(u.meta.last_row_id), c, tier });
  }
  for (const [i, a] of APPLICANTS.entries()) {
    await run(env.DB, `INSERT INTO partners (company, contact_name, email, street, house_no, postcode, city, country, language, business_type, status, created_at)
      VALUES (?, ?, ?, ?, '1', ?, ?, 'CH', ?, ?, 'pending', ?)`, a.company, a.contact, `demo+app${i + 1}@example.test`, a.street, a.postcode, a.city, a.lang, a.type, t0 - (i ? 5 : 26) * 3_600_000);
  }

  // Orders: more each week (a growing business), a few cancellations, two waiting for approval.
  let orders = 0, invoices = 0;
  const audits: [number, string, string, string, string, string][] = [];
  for (let w = 11; w >= 0; w--) {
    const count = 2 + Math.round((11 - w) * 0.55 + rand() * 3);
    for (let k = 0; k < count; k++) {
      const created = t0 - w * 7 * DAY - Math.floor(rand() * 6.5 * DAY) - 3_600_000;
      if (created > t0 - 20 * 60_000) continue;
      const p = pick(partners);
      const n = 2 + Math.floor(rand() * 4);
      const chosen = [...new Set(Array.from({ length: n }, () => pick(products)))];
      const qtys = chosen.map(() => (1 + Math.floor(rand() * (p.c.type === 'hotel' ? 8 : 4))) * 6);
      const build = () => chosen.map((pr, i) => {
        const base = { priceRappen: pr.price_rappen, pricesIncludeTax: !!pr.prices_include_tax, vatRateBp: RATE[pr.vat_code] ?? 810, discountBp: p.tier.discount_bp };
        const qty = qtys[i]!;
        return { line_no: i + 1, product_id: pr.id, source_id: pr.source_id, sku: pr.sku, name: pr.name ?? pr.sku, image_url: '', qty,
          unit_net_rappen: unitNetRappen(base), line_net_rappen: lineNetRappen({ ...base, qty }), vat_code: pr.vat_code, vat_rate_bp: base.vatRateBp, carton_multiple: null, min_qty: null };
      });
      let lines = build();
      // Respect the CHF 200 net minimum, like the real checkout does.
      for (let guard = 0; lines.reduce((a, l) => a + l.line_net_rappen, 0) < 22_000 && guard < 60; guard++) {
        qtys[guard % qtys.length] = Math.min(999, qtys[guard % qtys.length]! + 6);
        lines = build();
      }
      const tot = totals(lines.map((l) => ({ vatRateBp: l.vat_rate_bp, lineNetRappen: l.line_net_rappen })), !!shop.vat_registered);
      const r = rand();
      const recent = w === 0 && k >= count - 2;
      const state = recent ? 'awaiting_approval' : r < 0.06 ? 'cancelled' : 'confirmed';
      const ref = `MT-${demoRef(rand)}`;
      const confirmedAt = state === 'confirmed' ? created + 30 * 60_000 : null;
      const res = await run(env.DB, `INSERT INTO orders (ref, partner_id, placed_by, state, po_number, ship_mode, ship_to, note, language, currency, subtotal_net_rappen, vat_rappen, total_rappen, pricing_snapshot, created_at, confirm_after, confirmed_at, cancelled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'CHF', ?, ?, ?, ?, ?, ?, ?, ?)`,
        ref, p.id, p.userId, state, rand() < 0.5 ? `PO-${1000 + Math.floor(rand() * 9000)}` : '', rand() < 0.15 ? 'pickup' : 'delivery',
        JSON.stringify({ company: p.c.company, contact: p.c.contact, street: p.c.street, house_no: '1', postcode: p.c.postcode, city: p.c.city, country: 'CH' }),
        p.c.lang, tot.subtotalNetRappen, tot.vatRappen, tot.totalRappen,
        JSON.stringify({ at: created, tier: p.tier.name, discount_bp: p.tier.discount_bp, vat_registered: !!shop.vat_registered, lines, totals: tot }),
        created, created + 30 * 60_000, confirmedAt, state === 'cancelled' ? created + 10 * 60_000 : null);
      const orderId = Number(res.meta.last_row_id);
      await env.DB.batch(lines.map((l) => env.DB.prepare(`INSERT INTO order_lines (order_id, line_no, product_id, source_id, sku, name, qty, unit_net_rappen, line_net_rappen, vat_code, vat_rate_bp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(orderId, l.line_no, l.product_id, l.source_id, l.sku, l.name, l.qty, l.unit_net_rappen, l.line_net_rappen, l.vat_code, l.vat_rate_bp)));
      orders++;
      audits.push([created, 'partner', `partner:demo+${partners.indexOf(p) + 1}@example.test`, 'order.place', `order:${ref}`, JSON.stringify({ total_rappen: tot.totalRappen })]);
      if (confirmedAt) {
        const issue = isoDate(confirmedAt);
        const due = addDaysISO(issue, 14);
        const age = (t0 - confirmedAt) / DAY;
        // Most older invoices are paid; a couple of recent-ish ones run late.
        const status = age > 30 ? (rand() < 0.9 ? 'paid' : 'open') : age > 16 ? (rand() < 0.6 ? 'paid' : 'open') : rand() < 0.15 ? 'paid' : 'open';
        await env.DB.batch([
          env.DB.prepare("UPDATE counters SET value = value + 1 WHERE name = 'invoice'"),
          env.DB.prepare(`INSERT INTO invoices (kind, number, order_id, partner_id, issue_date, due_date, language, currency, net_rappen, vat_rappen, total_rappen, vat_breakdown, reference, status, paid_at, created_at)
            VALUES ('invoice', (SELECT value FROM counters WHERE name = 'invoice'), ?, ?, ?, ?, ?, 'CHF', ?, ?, ?, ?, '', ?, ?, ?)`)
            .bind(orderId, p.id, issue, due, p.c.lang, tot.subtotalNetRappen, tot.vatRappen, tot.totalRappen, JSON.stringify(tot.breakdown), status,
              status === 'paid' ? confirmedAt + Math.floor((8 + rand() * 12) * DAY) : null, confirmedAt),
        ]);
        const inv = await one<{ id: number; number: number }>(env.DB, "SELECT id, number FROM invoices WHERE order_id = ? AND kind = 'invoice'", orderId);
        if (inv) {
          const body = String(inv.number).padStart(10, '0');
          await run(env.DB, 'UPDATE invoices SET reference = ? WHERE id = ?', shop.iban && isQrIban(shop.iban) ? makeQrr(body) : makeScor(body), inv.id);
        }
        invoices++;
        audits.push([confirmedAt, 'system', 'system:cancel-window', 'order.confirm', `order:${ref}`, '{}']);
      }
    }
  }

  // The agent's recent work, and one proposal waiting for the owner.
  const pending = await one<{ id: number }>(env.DB, "SELECT id FROM partners WHERE email = 'demo+app2@example.test'");
  if (pending) {
    await run(env.DB, `INSERT INTO proposals (kind, target_id, payload, reason, proposed_by, status, created_at) VALUES ('partner_decision', ?, ?, ?, 'agent:Claude', 'open', ?)`,
      pending.id, JSON.stringify({ decision: 'approve', tier: std.name }), 'Hotel in Champéry, UID checks out, 40 rooms — approve on Standard?', t0 - 4 * 3_600_000);
  }
  for (const [ago, action, target, detail] of [
    [3 * DAY, 'catalog.set_translation', 'product:1', '{"lang":"it","provenance":"agent"}'],
    [3 * DAY - 60_000, 'catalog.set_translation', 'product:2', '{"lang":"fr","provenance":"agent"}'],
    [2 * DAY, 'partner.invite', `partner:${partners[8]!.id}`, JSON.stringify({ company: partners[8]!.c.company })],
    [30 * 3_600_000, 'settings.update', 'settings', '{"cancel_window_minutes":30}'],
    [6 * 3_600_000, 'invoice.mark_paid', 'invoice:3', '{}'],
    [4 * 3_600_000, 'proposal.create', 'proposal:1', '{"kind":"partner_decision"}'],
  ] as const) audits.push([t0 - ago, 'agent', 'agent:Claude', action, target, detail]);
  audits.push([t0 - 26 * 3_600_000, 'partner', 'partner:demo+app1@example.test', 'partner.apply', 'partner:0', JSON.stringify({ company: APPLICANTS[0]!.company })]);
  audits.push([t0 - 5 * 3_600_000, 'partner', 'partner:demo+app2@example.test', 'partner.apply', 'partner:0', JSON.stringify({ company: APPLICANTS[1]!.company })]);
  audits.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < audits.length; i += 50)
    await env.DB.batch(audits.slice(i, i + 50).map((a) => env.DB.prepare('INSERT INTO audit_log (at, actor_type, actor_label, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)').bind(...a)));

  // Products the agent read off the shop's own website (any shop system, not only WooCommerce).
  // New ones wait for the owner to confirm the price; one confirmed earlier has a price change waiting.
  const agent: Actor = { type: 'agent', id: 0, label: 'Claude', scope: 'configure' };
  const settings = await getSettings(env.DB);
  const found: AgentProductInput[] = FOUND.map((f) => ({ source_id: f.id, sku: f.sku, source_url: `https://shop.example/products/${f.id}`, price_rappen: f.price, prices_include_tax: true, vat_code: 'standard', texts: f.texts }));
  await upsertAgentProducts(env.DB, agent, found, settings);
  await run(env.DB, "UPDATE products SET price_confirmed_at = ? WHERE source = 'agent' AND source_id = ?", t0 - 6 * DAY, FOUND[0]!.id);
  await upsertAgentProducts(env.DB, agent, [{ ...found[0]!, price_rappen: 2490 }], settings);
  return { partners: partners.length + APPLICANTS.length, orders, invoices };
}

const FOUND: { id: string; sku: string; price: number | null; texts: AgentProductInput['texts'] }[] = [
  { id: 'glass-bottle', sku: 'GB-050', price: 2290, texts: { de: { name: 'Glas-Trinkflasche 0,5 l' }, fr: { name: 'Gourde en verre 0,5 l' }, it: { name: 'Borraccia in vetro 0,5 l' }, en: { name: 'Glass water bottle 0.5 l' } } },
  { id: 'linen-towel', sku: 'LT-01', price: 1890, texts: { de: { name: 'Leinen-Handtuch' }, fr: { name: 'Essuie-mains en lin' }, it: { name: 'Asciugamano in lino' }, en: { name: 'Linen hand towel' } } },
  { id: 'stoneware-mug', sku: 'MUG-35', price: 1450, texts: { de: { name: 'Steingut-Becher' }, fr: { name: 'Mug en grès' }, it: { name: 'Tazza in gres' }, en: { name: 'Stoneware mug' } } },
  { id: 'room-diffuser', sku: 'RD-200', price: 3900, texts: { de: { name: 'Raumduft-Diffuser 200 ml' }, fr: { name: 'Diffuseur d’ambiance 200 ml' }, it: { name: 'Diffusore per ambienti 200 ml' }, en: { name: 'Room diffuser 200 ml' } } },
  { id: 'gift-box', sku: 'GIFT-01', price: null, texts: { de: { name: 'Geschenkbox' }, fr: { name: 'Coffret cadeau' }, it: { name: 'Confezione regalo' }, en: { name: 'Gift box' } } },
];

function demoRef(rand: () => number): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
}
