import { LANGS } from '../i18n';
import { html, raw, type Html } from '../lib/html';
import { icon } from './charts';
import { legalHref } from '../legal/links';
import type { Ctx } from './context';

const LOGO = raw(`<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5 7.5 10v4l4.5 2.5 4.5-2.5v-4z" fill="currentColor"/></svg>`);

/** The owner's console: sidebar navigation (top bar on phones) around the page. */
function consolePage(ctx: Ctx, opts: { title: string; body: Html; narrow?: boolean }): Html {
  const { t } = ctx;
  const shopName = ctx.shop?.legal_name ?? 'MoltenRock Trade';
  const here = ctx.url.pathname;
  const link = (href: string, ic: string, label: string, extra: Html | string = '') =>
    html`<a href="${href}" class="${here === href ? 'on' : ''}" ${here === href ? html`aria-current="page"` : ''}>${icon(ic)}<span>${label}</span>${extra}</a>`;
  const langs = LANGS.map((l) => html`<a href="${here}?lang=${l}" class="${l === ctx.lang ? 'on' : ''}" hreflang="${l}" lang="${l}">${l.toUpperCase()}</a>`);
  return html`<html lang="${ctx.lang}-CH">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · ${shopName}</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
</head>
<body class="console">
<div class="shell">
  <aside class="side">
    <a class="side-brand" href="/merchant">${LOGO}<span><b>${shopName}</b><small>MoltenRock Trade</small></span></a>
    <nav class="side-nav" aria-label="Console">
      ${link('/merchant', 'dashboard', t('m.nav.dashboard'))}
      ${link('/merchant/approvals', 'approvals', t('m.nav.approvals'), ctx.approvals ? html`<span class="count">${ctx.approvals}</span>` : '')}
      ${link('/merchant/setup', 'setup', t('m.nav.home'))}
      ${link('/status', 'status', t('m.nav.status'))}
      ${link('/merchant/exports', 'download', t('m.nav.exports'))}
    </nav>
    <div class="side-foot">
      <a class="side-link" href="/" target="_blank" rel="noopener">${icon('store')}<span>${t('m.nav.storefront')}</span></a>
      <form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${ctx.viewer?.session.csrf ?? ''}"><button class="side-link">${icon('logout')}<span>${t('nav.logout')}</span></button></form>
      <div class="langs">${langs}</div>
    </div>
  </aside>
  <main class="stage ${opts.narrow ? 'narrow' : ''}">
${opts.body}
  </main>
</div>
</body>
</html>`;
}

export function page(ctx: Ctx, opts: { title: string; body: Html; area?: 'buyer' | 'merchant' | 'public'; narrow?: boolean }): Html {
  if (opts.area === 'merchant' && ctx.viewer?.actor.type === 'user') return consolePage(ctx, opts);
  const { t } = ctx;
  const shopName = ctx.shop?.legal_name ?? 'MoltenRock Trade';
  const v = ctx.viewer;
  const csrf = v?.session.csrf ?? '';
  const nav = v?.actor.type === 'partner' && v.partner?.status === 'approved'
    ? html`<a href="/catalog">${t('nav.catalog')}</a><a href="/cart">${t('nav.cart')}</a><a href="/orders">${t('nav.orders')}</a>`
    : v?.actor.type === 'user'
      ? html`<a href="/merchant">${t('m.nav.home')}</a><a href="/merchant/approvals">${t('m.nav.approvals')}</a><a href="/status">${t('m.nav.status')}</a>`
      : html``;
  const auth = v
    ? html`<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="link">${t('nav.logout')}</button></form>`
    : html`<a href="/login">${t('nav.login')}</a>`;
  const here = ctx.url.pathname;
  const langs = LANGS.map((l) => html`<a href="${here}?lang=${l}" class="${l === ctx.lang ? 'on' : ''}" hreflang="${l}" lang="${l}">${l.toUpperCase()}</a>`);
  return html`<html lang="${ctx.lang}-CH">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · ${shopName}</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
</head>
<body class="${opts.area ?? 'buyer'}">
<header class="top">
  <a class="brand" href="/">${LOGO}<span>${shopName}</span><small>${opts.area === 'merchant' ? 'Merchant' : t('app.tradePortal')}</small></a>
  <nav>${nav}${auth}</nav>
  <div class="langs">${langs}</div>
</header>
<main class="${opts.narrow ? 'narrow' : ''}">
${opts.body}
</main>
<footer class="foot">${ctx.shop ? html`<nav class="legal-links" aria-label="Legal">${(['terms', 'privacy', 'imprint'] as const).map((k) => html`<a href="${legalHref(ctx.settings, k)}">${t(`legal.${k}`)}</a>`)}</nav>` : ''}<span>${t('footer.poweredBy')}</span></footer>
</body>
</html>`;
}

export const csrfField = (ctx: Ctx) => html`<input type="hidden" name="_csrf" value="${ctx.viewer?.session.csrf ?? ''}">`;

export const notice = (kind: 'ok' | 'warn' | 'err' | 'info', text: string | Html) => html`<div class="notice ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${text}</div>`;

export function messagePage(ctx: Ctx, title: string, text: string, area: 'buyer' | 'merchant' | 'public' = 'public', status = 200): { body: Html; status: number } {
  return { body: page(ctx, { title, area, narrow: true, body: html`<section class="card"><h1>${title}</h1><p>${text}</p></section>` }), status };
}
