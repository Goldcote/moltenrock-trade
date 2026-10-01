# MoltenRock Trade — status (1 Oct 2026)

Verified end to end locally. Public code: [github.com/Goldcote/moltenrock-trade](https://github.com/Goldcote/moltenrock-trade) (one clean commit per release). First real deploy pending.

## Verified

- `npm run typecheck`: clean (TypeScript 7, strict).
- `npm test`: **80 unit tests pass**: pricing & VAT maths, approval threshold / minimum order / quantity rules, VAT effective dates, UID check digit, IBAN / QR-IBAN, SCOR & QRR references, QR-bill payload layout and rules, S1 billing info, QR-bill PDF in DE/FR/IT/EN incl. pagination, translation completeness, HTML escaping, the WooCommerce order hand-off built from settings, strict session cookie on https, CSV safety (BOM, separators, formula injection), export periods, the double-entry journal (invoices, payments, credit notes, non-VAT shops), all 24 legal pages (4 languages × 3 pages × variants), the update check, and the any-shop price rules (unconfirmed prices never orderable, changed prices wait, declined products stay out).
- `npm run smoke`: **98 end-to-end checks pass** from an **empty database with no setup commands** against the local dev server, including:
  - a **live read-only import of a real WooCommerce shop** (27 items, 4 languages, 23 Polylang groups merged, 12 unpriceable items flagged);
  - an invited French-speaking trade customer ordering, a confirmed order with a correct French QR-bill invoice, a held basket approved via agent proposal + human confirmation;
  - the WooCommerce hand-off built as a dry run from the agent's settings;
  - the owner dashboard, its live fragments, and the MoltenView view;
  - **one-address connect** end to end: discovery, registration, sign-in redirect, consent, PKCE, wrong verifier refused, replayed code refused *and* its access revoked, owner-chosen scope enforced, unregistered return address never redirected to;
  - **launch essentials**: legal pages filled with the shop's details, footer links, terms accepted on apply and by invited customers before their first order, agents refused on legal settings, the owner's own terms page used when set, the email test honest without a provider, invoices CSV (BOM, semicolons), a balanced journal, a backup without secrets, exports refused without login, agent download links (tampered links refused, backup never by link), the running version on Status, and the new settings validated;
  - **any shop**: the agent adds products from a website (https source pages only), they are not orderable and cannot be put in a basket until the owner confirms the price on Approvals; a trade customer cannot confirm; a changed price waits while the confirmed one stays; a declined product is not brought back; *Confirm all*; the dashboard queue and Setup step; no agent tool can confirm prices;
  - **IBAN later**: sign-up without IBAN, the bank step open, a non-Swiss IBAN refused with a clear message, the IBAN added later; a sign-in link for another browser without email; agent keys via `X-API-Key`;
  - idempotent retries, CSRF/cross-origin refusal, HUMAN_ONLY and scope enforcement, immediate token revocation.
- Journal reconciled against 75 invoices of demo data: receivables left = open invoices (CHF 16,921.13), VAT booked = VAT invoiced (CHF 3,693.42). Update notice checked end to end against a local version file.
- Looked at in a browser (light/dark, desktop/phone, DE/FR/IT/EN): storefront, sign-in, Setup, Dashboard (with `npm run demo` data), Approvals, Status, and the public site in `site/`.

## Features

| Area | State | Notes |
|---|---|---|
| Merchant sign-up (identity, UID, VAT registration, IBAN) | working | Human-only; explains why each field is needed; single shop per instance |
| Magic-link sign-in, sessions, CSRF, rate limits | working | Links hashed + single-use; POST confirm (scanner-safe); `__Host-` Secure cookie on https, plain cookie on local http (Safari); `?next=` carried through the emailed link |
| Owner console | working | Sidebar shell with Approvals badge; Dashboard, Approvals, Setup, Status; phone layout |
| Dashboard | working | Count-up KPIs with month-to-date comparison, 12-week revenue chart, invoice donut, per-language text rings, top customers, "waiting for you" queue and activity feed refreshing live; server-rendered SVG + CSS motion (strict CSP), reduced-motion respected |
| Setup (onboarding) | working | Three numbered steps, plain-language explanation of agents, WooCommerce read-only key how-to and the any-shop path, checklist that ticks itself off while the agent works |
| One-address agent connect | working | OAuth 2.1 auth code + PKCE (S256), dynamic client registration, protected-resource + authorization-server metadata, owner-only consent with scope choice, single-use codes, reconnect replaces the old access |
| Agent access keys (read / operate / configure) | working | Still available for agents that can't sign in themselves |
| MCP server `/mcp` (35 tools) | working | Stateless Streamable HTTP; 401 points to the connect metadata |
| REST mirror, OpenAPI, `/llms.txt` | working | Generated from the same tool registry |
| WooCommerce read-only import | working | Polylang/WPML groups → one product; variations; flags unpriceable items |
| Any shop via the agent (`upsert_products`) | working | Shopify, Wix, Squarespace, custom sites, spreadsheets, feeds: the agent adds products with their source page; not orderable until the owner confirms the price (Approvals → Prices to confirm, one by one or all); a changed price waits while the confirmed one stays in force; declined products stay out; agents have no way to confirm prices |
| Shopify connector | stub | Same interface; returns "coming soon" |
| Product texts DE/FR/IT/EN with provenance | working | imported / agent / human; fallback never shows an empty name |
| Tiers + templates, per-partner terms | working | Standard −40 / VIP −50 seeded; generic templates Partner −45 / Distributor −55 |
| Partner apply / invite / approve | working | Invite = approved on Standard; approval human-only (agents propose) |
| Catalogue, cart, checkout (server-side pricing) | working | Min order, carton multiples, stock mode |
| Order lifecycle | working | held → human approval; cancel window → confirm; cron + on-request finalisation |
| QR-bill invoices + credit notes | working | Gapless series; print-ready page on every plan; PDF on first download (Workers Paid) |
| Proposals + approvals | working | Partner decisions, held baskets, credit notes |
| Read-only status page + signed 1-hour link | working | Read-only dashboard + the 15 settings + product texts + latest hand-off |
| Fulfilment integrations | dry run | Built in: manual, and *hand the order to your WooCommerce shop* (order fields from settings). Payload built and shown, never sent. Partner connectors plug into the same slot ([FULFILMENT.md](FULFILMENT.md)) |
| Molten for Mac | partly | MoltenView view works today; Touch ID approvals and vault-held keys planned ([MOLTEN.md](MOLTEN.md)) |
| Email | optional | Resend via `RESEND_API_KEY` + `MAIL_FROM`; locally `/dev/mail`; without a provider the owner creates partner sign-in links to forward |
| Self-setup (tables, secrets, public URL) | working | No migration command, no secrets to type; Deploy-button ready (repo must be public) |
| Demo data | dev only | `npm run demo`: twelve weeks of fictional Swiss trade, refused unless `DEV=1` |
| Public website (`site/`) | working | Static, four languages, WebGL hero with CSS fallback, no third-party requests |
| Legal pages | working | Terms / privacy / legal notice built in (DE/FR/IT/EN, from the shop's data) or own pages; owner-only; acceptance + version recorded; invited customers accept on first sign-in ([LEGAL.md](LEGAL.md)) |
| Exports | working | Invoices (VAT per rate, status, payment date), lines, customers, double-entry journal (configurable accounts), complete backup (owner-only); signed one-hour links for agents |
| Email set-up | working | Setup step with guide and test button; dashboard notice while missing |
| Updates | working | Version on Status, daily check of moltenrocktrade.com/version.json (switchable), dashboard notice, one-click update workflow template for self-hosted copies ([UPDATING.md](UPDATING.md)) |
| Licence | done | FSL-1.1-ALv2, official text, `Copyright 2026 Goldcote Ltd` |

## Known gaps / next steps (prioritised)

1. **Public repository**: done (1 Oct 2026), `Goldcote/moltenrock-trade`, so the Deploy button works.
2. **Legal review** of the built-in terms and privacy templates and the site's legal notice / privacy pages (Swiss lawyer); trademark check for "MoltenRock Trade".
3. **Activate the update workflow** in the repo (`docs/github-update-workflow.yml` → `.github/workflows/`): needs a GitHub token with the `workflow` permission. Publish `site/` on moltenrocktrade.com so `version.json` is live.
4. **First real deploy** to a test Cloudflare account; verify the cron trigger, the EU-database-by-name path, and one-address connect from the Claude app against the https address.
5. **QR-bill validation**: run generated bills through the SIX validation portal and scan with two banking apps before real invoices go out; accountant sign-off on the VAT rounding method.
6. **Switch the WooCommerce hand-off on**: needs a dedicated write key limited to orders, a small WordPress snippet that mutes WooCommerce's customer emails for orders marked `_moltentrade_silent`, and one supervised order on a real shop. Until then it stays a dry run.
7. **Fulfilment partners**: named presets for partner connectors (e.g. a 3PL connector for WooCommerce), then a direct, signed order format (`moltentrade.order.v1`). Choosing where order data goes stays a human-confirmed decision.
8. **UID-Register lookup** (GetByUID): today only the check digit is validated.
9. **Molten**: a MoltenRock Trade lane in MoltenRock Connect (Touch ID approvals), vault-held agent keys.
10. **Direct Shopify / Wix connectors** (read-only scopes) through the same interface – any shop already works through the agent today; direct connectors would add automatic re-sync.
11. Partial credit notes, payment matching from bank statements (camt.054), EUR invoicing.

## Deliberately out of scope

Payment providers (by design), multiple shops per instance, real writes to any shop. Not yet done: a real deployment.
