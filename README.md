# MoltenRock Trade

**An agent-first Swiss B2B trade portal for any online shop.** A merchant signs up, connects their own AI agent with one address, and the agent sets up the trade store: it reads the catalogue (WooCommerce with a *read-only* key; Shopify, Wix, Squarespace, a custom website or a spreadsheet by reading the products itself, with every price confirmed by the owner), writes product texts in German, French, Italian and English, and walks the owner through sensible Swiss defaults. Trade customers apply, get approved, see their net tier prices, order above a minimum and pay later by **Swiss QR-bill invoice (Net 14)**. There is no payment provider: Swiss B2B runs on trust and invoice.

There is **no settings back office**. The agent is the back office (over MCP). People see a storefront, and the owner gets a small console: **Dashboard**, **Approvals**, **Setup** and a read-only **Status** page. Agents prepare everything; **people confirm trust and money decisions** (approving trade accounts, big baskets, credit notes) and are the only ones who can change company identity, VAT number and bank details.

## What's in the box

| Part | What it does |
|---|---|
| Storefront (trade customers) | Apply, sign in by email link, catalogue at net tier prices in 4 languages, cart, checkout, cancel window, orders, QR-bill invoices |
| Owner console | Animated dashboard (revenue, orders, open/overdue invoices, what waits for you, top customers, product-text coverage, live activity feed), Approvals, three-step Setup, read-only Status |
| Any shop | WooCommerce connects directly (read-only key, Polylang/WPML translations). Any other shop – Shopify, Wix, Squarespace, a custom site, a spreadsheet or a feed: the agent reads the products and adds them with `upsert_products`, keeping the page each price came from. The owner confirms every price under **Approvals → Prices to confirm** before it is orderable; a later price change waits for confirmation while the confirmed price stays in force |
| One-address connect | Paste `https://<your portal>/mcp` into Claude; sign in, click **Allow**. OAuth 2.1 + PKCE, owner picks the permission; no keys to copy |
| Agent surface | MCP server (35 tools) + REST mirror, OpenAPI and `/llms.txt`, all from one registry |
| Invoices | Swiss QR-bill (SCOR / QR-IBAN reference), gapless numbers, VAT per rate, credit notes; print-ready page on every plan, PDF on Workers Paid |
| Fulfilment | Manual by default, or *hand the order to your WooCommerce shop* (dry run in this version), see [docs/FULFILMENT.md](docs/FULFILMENT.md) |
| Molten for Mac (optional) | Today: the agent can show the dashboard live in MoltenView. Coming: Touch ID approvals, keys in the MoltenRock vault. See [docs/MOLTEN.md](docs/MOLTEN.md) |
| Legal pages | Terms for trade customers, privacy notice and legal notice built in (DE/FR/IT/EN, filled with the shop's details) or the merchant's own pages; acceptance recorded, invited customers accept on first sign-in. See [docs/LEGAL.md](docs/LEGAL.md) |
| Exports | Invoices and credit notes, invoice lines, customers, a double-entry journal (Banana / Bexio / Abacus, Swiss SME chart) and a complete backup; agents can hand out signed one-hour links |
| Email | Optional (Resend); a Setup step walks the owner through it, with a *Send test email* button |
| Updates | Knows its version, checks daily for a newer one (can be switched off), one-click update workflow for self-hosted copies. See [docs/UPDATING.md](docs/UPDATING.md) |
| Public website | Static marketing site in [`site/`](site/) (four languages, legal notice and privacy pages, share image, no third-party requests) |

## Run it on your own free Cloudflare account (about 10 minutes, no terminal)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Goldcote/moltenrock-trade)

**What you need:** a free Cloudflare account, a free GitHub account and an AI agent such as Claude (the free plan can connect it). Step by step, with copy-and-paste instructions for your agent: **[moltenrocktrade.com/start](https://moltenrocktrade.com/start)** or **[docs/SELF-HOST.md](docs/SELF-HOST.md)**. The app creates its own database tables and security keys on first start.

## Run it locally

```bash
npm install
npm run dev                  # http://localhost:8787 (sets itself up on first request)
```

- Nothing to configure. Optional: copy `.dev.vars.sample` to `.dev.vars` for a read-only WooCommerce key (used by the smoke test) or Resend email.
- Locally, every email lands in the **dev mailbox at `/dev/mail`**.
- `npm run demo` fills the local database with twelve weeks of fictional Swiss trade so the dashboard has something to show (only with `DEV=1`; needs an imported catalogue, e.g. after `npm run smoke`).
- `npm run db:reset:local` wipes the local database (it is recreated on the next request).

Checks:

```bash
npm run typecheck && npm test        # 65 unit tests
npm run smoke                        # 76 end-to-end checks against a running dev server with a fresh database
```

## Connect your agent

1. Signed in as the owner, open **Setup**.
2. **Claude app** (Mac, Windows, web): Settings → Connectors → *Add custom connector* → paste `https://<your portal>/mcp` → Connect → sign in → **Allow**. This needs the portal online (https).
3. **Claude Code**: `claude mcp add --transport http moltenrock-trade https://<your portal>/mcp`, then `/mcp` → Authenticate → **Allow**. Works locally too (`http://localhost:8787/mcp`).
4. Any other agent: create an access key under *Another agent* and send `Authorization: Bearer <key>`.
5. Tell it: *"Set up my trade portal."* It starts with `get_setup_status` and follows `next_action`.

Agents without MCP use the same tools over REST: `POST /api/v1/tools/<tool>` (OpenAPI at `/api/v1/openapi.json`); `/llms.txt` describes everything.

**What agents can't do:** change company identity, VAT number, IBAN or agent access (`HUMAN_ONLY`), or approve trade accounts / held baskets / credit notes themselves: they file a proposal (`propose_*`) that the owner confirms under **Approvals**. Every action is in the append-only audit log.

## The 15 defaults (all adjustable, by the agent or by you through your agent)

| # | Default |
|---|---|
| 1 | Approve each trade account once; baskets **over CHF 5,000 net** wait for approval (0 = hold all, null = never); invited partners are approved on Standard |
| 2 | Minimum order **CHF 200 net** (per-partner override) |
| 3 | **Net 14** (per-partner override) |
| 4–5 | Tiers **Standard −40 %** and **VIP −50 %** + unlimited custom; generic templates *Partner −45 %* and *Distributor −55 %* |
| 6 | Discount off the price **excluding VAT**; VAT (8.1 %) on its own line, only if VAT-registered |
| 7 | No carton sizes by default; any quantity 1–999 |
| 8 | Everything orderable regardless of shop stock (setting: respect stock) |
| 9 | All shop products orderable; unpriceable items (e.g. bundles) flagged and excluded |
| 10 | Fulfilment via integrations; core has no warehouse code. Built in: *manual* (default) and *hand the order to your WooCommerce shop* (**dry run in this version**). Fulfilment partners plug into the same slot: [docs/FULFILMENT.md](docs/FULFILMENT.md) |
| 11 | Data in Cloudflare's **EU jurisdiction** (chosen at deploy) |
| 12 | **QR-bill** invoice per order (print-ready page on every plan; PDF download on Workers Paid), gapless numbering, credit notes for corrections |
| 13–15 | Single shop per instance; productized from day one |

## Guardrails

- **Read-only towards the merchant's shop**: the WooCommerce connector only issues `GET` requests.
- **Fulfilment hand-off is a dry run**: the WooCommerce profile builds the exact order it would create in your shop (status, offline payment method and extra order fields all come from settings) and shows it on the Status page. It never sends it.
- **Agent connect**: OAuth 2.1 authorization code with mandatory PKCE (S256), exact redirect matching, single-use codes (a replayed code revokes what it issued), consent only by the owner, CSP `form-action` limited to the one return address.
- **No payment provider** (by design). Email is only sent if you add a provider (Resend); locally it goes to `/dev/mail`.
- Money is integer rappen, discounts basis points; all pricing is server-side (browsers and agents only send product ids and quantities).
- Priced/private responses are `Cache-Control: private, no-store`; strict CSP (`script-src 'self'`, no inline scripts or styles, so the dashboard charts are server-rendered SVG animated with CSS); `__Host-` Secure session cookie (a plain cookie only on local `http://localhost`, which Safari needs); CSRF checks; hashed single-use magic links; hashed, scoped, revocable agent tokens.

## Free plan notes

- Everything runs on Cloudflare's free plan except the **server-generated PDF** (≈25–35 ms CPU vs. the free plan's 10 ms). Invoices are therefore shown as a print-ready QR-bill page (≈5 ms CPU) that the browser saves as PDF; the one-click PDF download needs Cloudflare's Workers Paid plan (USD 5/month, billed by Cloudflare, not by us).
- Email is optional (Resend). Without it, the owner is signed in straight after sign-up, sessions extend while used, and partner sign-in links are created on the Approvals page to forward.

## Licence

[FSL-1.1-ALv2](LICENSE.md) (Functional Source License, fair source): free to use, change and self-host for your own business; not for building a competing commercial product. Each version becomes Apache 2.0 two years after release.
