# Changelog

## 0.3.0 — any shop

- **Any shop, not only WooCommerce.** Shopify, Wix, Squarespace, a custom website, a spreadsheet or a product feed: the agent reads the products itself and adds them with the new `upsert_products` tool (up to 100 per call, with the page each price came from). WooCommerce still connects directly with a read-only key.
- **People confirm the prices.** Products the agent added are not orderable until the owner confirms their price under **Approvals → Prices to confirm** (one by one or *Confirm all*, with the source page and the change in %). A later price change on the website waits for confirmation while the confirmed price stays in force; a declined product is not brought back by the agent; agents have no way to confirm prices. The dashboard queue, the Approvals badge, the Setup checklist (`confirm_prices`) and the MoltenView view show what is waiting.
- Setup instructions for the agent (portal, website, docs) ask which shop system you use first; `list_products` has a new `unconfirmed` filter; the agent instructions say how any shop works.
- Public website: home page for any shop (new *Any shop* section with the agent reading a website and the owner confirming prices), and a redesigned **Get started** page: progress you can tick off (saved in your browser), a sticky step rail, a moving preview for every step, an explainer of what an AI agent does and never does.
- Console: *Prices to confirm* panel; prompts wrap at word boundaries.
- Database: migration `0004_any_shop` (source page, confirmation time and a waiting price change per product).

## 0.2.1

- Tier templates are generic B2B (Partner −45 %, Distributor −55 %); no industry-specific templates.
- Setup: the full instructions for your agent to copy and paste; Claude's connector menu is *Customize → Connectors* (free plan works).
- MoltenRock card shortened: what the Mac app does today.
- Public site: step-by-step **Get started** page (`/start`) with copy-and-paste instructions for your agent; generic sample product.

## 0.2.0 — launch essentials

- **Legal pages** in every portal: general terms for trade customers, privacy notice and legal notice, built in (DE/FR/IT/EN, filled with the shop's own details and settings) or the merchant's own pages. Invited trade customers accept the terms once before their first order; the accepted version is recorded.
- **Exports for bookkeeping**: invoices and credit notes (VAT per rate, payment status), invoice lines, trade customers, and a double-entry journal for Banana / Bexio / Abacus (Swiss SME chart by default); complete JSON backup for the owner. Agents can hand out signed one-hour download links (`get_export_link`).
- **Email set-up** as a Setup step with a guide and a *Send test email* button; the dashboard says when email is missing.
- **Update check**: the portal knows its version, checks daily for a newer one (can be switched off) and shows it on the Dashboard and Status page; one-click update workflow for self-hosted copies ([docs/UPDATING.md](docs/UPDATING.md)).
- Public site: legal notice and privacy pages, share image, `version.json`.
- Database: migration `0003_launch` (adds `partners.terms_version`).

## 0.1.0

- First build: storefront, owner console, one-address agent connect, MCP tools, QR-bill invoices, WooCommerce import, public site.
