# MoltenRock Trade — public website

A single static page (`index.html` + `assets/site.css` + `assets/site.js`) presenting MoltenRock Trade. It is separate from the portal itself: every merchant's portal is their own trade shop; this page is the product's front door, intended for **moltenrocktrade.com** (canonical URL already set).

- **Four languages** (EN in the HTML, DE/FR/IT in `site.js`), picked by `?lang=`, the visitor's browser language, or the switch; the choice is remembered in the browser.
- **No third-party requests**: no web fonts, no analytics, no CDNs (Swiss/EU privacy friendly).
- **Motion**: WebGL "molten" hero background that follows the cursor (falls back to a CSS gradient), a live agent session in the hero, scroll-driven "how it works", interactive trade-price calculator using the portal's real rules (discount on the net price, VAT 8.1 % on its own line, CHF 200 minimum, CHF 5,000 approval), an *Any shop* scene (the agent reads a website, the owner confirms the prices), four-language product card, animated QR-bill, tool marquee, magnetic buttons. The **Get started** page (`start.html`) has a progress ring and checklist saved in the browser, a sticky step rail and a moving preview for every step. Everything stops under `prefers-reduced-motion`, and the page is complete without JavaScript.

## Files

| File | What it is |
|---|---|
| `index.html`, `assets/site.css`, `assets/site.js` | The home page |
| `start.html`, `assets/start-i18n.js` | Get started: step-by-step guide with copy-and-paste instructions for the agent |
| `imprint.html`, `privacy.html`, `assets/legal-i18n.js` | Legal notice and privacy notice (Goldcote Ltd), four languages |
| `404.html` | Not-found page (Cloudflare Pages serves it automatically) |
| `version.json` | The newest MoltenRock Trade version; every portal checks it once a day (see `docs/UPDATING.md`) |
| `assets/og.png`, `assets/apple-touch-icon.png` | Share image (1200×630) and home-screen icon, rendered from `og/*.html` |
| `_headers` | Security headers for Cloudflare Pages (strict CSP, HSTS, no framing) |
| `robots.txt`, `sitemap.xml` | For search engines |

When you publish a new version, bump the `?v=` stamp on the CSS/JS links (assets are cached for a day) and `version.json`.

To re-render the images: open `og/og.html` / `og/icon.html` in Chrome at 1200×630 / 180×180, or run Chrome headless with `--screenshot`.

## Preview locally

```bash
python3 -m http.server 8790 --directory site
```

Then open http://localhost:8790 (add `?lang=de`, `fr` or `it`).

## Publish

It is plain static files: Cloudflare Pages (drag the `site/` folder into a new Pages project), then point moltenrocktrade.com at it (Custom domains). The "Deploy to Cloudflare" button points at the public repository `github.com/Goldcote/moltenrock-trade`.
