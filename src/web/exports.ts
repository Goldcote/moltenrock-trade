// Exports page (owner console) and the downloads behind it. Files are built on request from the
// database; nothing is stored. Agents can hand out a signed one-hour link for the accounting files
// (never the complete backup, which is for the owner only).

import type { Env } from '../lib/env';
import { AppError, PRIVATE_HEADERS, withHeaders } from '../lib/http';
import { html } from '../lib/html';
import { hmacHex, safeEqual } from '../lib/crypto';
import { getSecrets } from '../lib/bootstrap';
import { audit, now } from '../domain/db';
import { AGENT_EXPORT_FILES, buildExport, EXPORT_FILES, parsePeriod, type ExportFile } from '../domain/exports';
import { getSettings } from '../domain/settings';
import { htmlResponse, redirect } from '../lib/http';
import { icon } from './charts';
import type { Ctx } from './context';
import { page } from './layout';

const LINK_TTL = 60 * 60 * 1000;
const isFile = (f: string): f is ExportFile => (EXPORT_FILES as readonly string[]).includes(f);

function periodOptions(today = new Date()): { value: string; label: string }[] {
  const y = today.getUTCFullYear();
  const opts = [{ value: String(y), label: String(y) }];
  const q = Math.floor(today.getUTCMonth() / 3) + 1;
  for (let i = q; i >= 1; i--) opts.push({ value: `${y}-Q${i}`, label: `${y} · Q${i}` });
  opts.push({ value: String(y - 1), label: String(y - 1) });
  for (let i = 4; i >= 1; i--) opts.push({ value: `${y - 1}-Q${i}`, label: `${y - 1} · Q${i}` });
  opts.push({ value: String(y - 2), label: String(y - 2) });
  return opts;
}

export async function exportsPage(ctx: Ctx): Promise<Response> {
  const v = ctx.viewer;
  if (!ctx.shop) return redirect('/merchant/signup');
  if (!v || v.actor.type !== 'user') return redirect('/login');
  const { t } = ctx;
  let period;
  try { period = parsePeriod(ctx.url.searchParams.get('period')); } catch { period = parsePeriod(null); }
  const acc = ctx.settings.accounting_accounts;
  const owner = v.actor.role === 'owner';
  const files: { file: ExportFile; title: string; desc: string; ic: string; periodless?: boolean }[] = [
    { file: 'invoices', title: t('x.invoices'), desc: t('x.invoicesDesc'), ic: 'order' },
    { file: 'journal', title: t('x.journal'), desc: t('x.journalDesc', { acc: `${acc.receivables} · ${acc.revenue} · ${acc.vat} · ${acc.bank}` }), ic: 'status' },
    { file: 'invoice-lines', title: t('x.lines'), desc: t('x.linesDesc'), ic: 'dashboard' },
    { file: 'customers', title: t('x.customers'), desc: t('x.customersDesc'), ic: 'partner', periodless: true },
  ];
  const q = `?period=${encodeURIComponent(period.label)}`;
  return htmlResponse(page(ctx, {
    title: t('x.title'), area: 'merchant',
    body: html`<div class="dash">
      <header class="dash-head"><div><p class="eyebrow">${t('m.nav.exports')}</p><h1>${t('x.title')}</h1><p class="lead">${t('x.lead')}</p></div></header>
      <form class="panel period-bar" method="get" action="/merchant/exports">
        <label for="period">${t('x.period')}</label>
        <select id="period" name="period">${[...periodOptions(), { value: 'all', label: t('x.all') }].map((o) => html`<option value="${o.value}" ${o.value === period.label ? html`selected` : ''}>${o.label}</option>`)}</select>
        <button type="submit" class="secondary small">${t('x.show')}</button>
      </form>
      <section class="export-grid">
        ${files.map((f) => html`<article class="panel export" data-spot>
          <span class="x-ic">${icon(f.ic)}</span>
          <div><h2>${f.title}</h2><p>${f.desc}</p></div>
          <a class="btn secondary" href="/merchant/exports/${f.file}${f.periodless ? '' : q}" download>${icon('arrow')}${t('x.download')} <small>${f.periodless ? 'CSV' : `CSV · ${period.label === 'all' ? t('x.all') : period.label}`}</small></a>
        </article>`)}
        ${owner ? html`<article class="panel export backup" data-spot>
          <span class="x-ic">${icon('approvals')}</span>
          <div><h2>${t('x.backup')}</h2><p>${t('x.backupDesc')}</p></div>
          <a class="btn secondary" href="/merchant/exports/backup" download>${icon('arrow')}${t('x.download')} <small>JSON</small></a>
        </article>` : ''}
      </section>
      <aside class="molten-strip">${icon('check')}<p>${t('x.csvNote')} ${t('x.history')} ${t('x.agent')}</p></aside>
    </div>`,
  }));
}

async function send(env: Env, ctx: Ctx, file: ExportFile, periodLabel: string | null, via: string): Promise<Response> {
  const period = parsePeriod(periodLabel);
  const out = await buildExport(env, file, period, await getSettings(env.DB));
  await audit(env.DB, ctx.viewer?.actor ?? { type: 'system', label: 'export-link' }, 'export.download', `export:${file}`, { period: period.label, via });
  return withHeaders(new Response(out.body, { headers: { 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, ...PRIVATE_HEADERS } }));
}

/** Owner / staff download. The complete backup is owner-only. */
export async function exportDownload(ctx: Ctx, file: string): Promise<Response> {
  const v = ctx.viewer;
  if (!v || v.actor.type !== 'user') throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  if (!isFile(file)) throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  if (file === 'backup' && v.actor.role !== 'owner') throw new AppError('HUMAN_ONLY', 'Only the owner can download the complete backup.', 403);
  return send(ctx.env, ctx, file, ctx.url.searchParams.get('period'), 'console');
}

const sign = async (env: Env, file: string, period: string, exp: number) => hmacHex((await getSecrets(env)).sessionSecret, `export:${file}:${period}:${exp}`);

/** A signed, one-hour download link an agent can give its human (accounting files only). */
export async function exportLink(env: Env, baseUrl: string, file: string, periodInput: string | undefined): Promise<{ url: string; file: string; period: string; expires_at: number }> {
  if (!isFile(file) || !AGENT_EXPORT_FILES.includes(file)) throw new AppError('INVALID_FILE', `file must be one of ${AGENT_EXPORT_FILES.join(', ')} (the complete backup is for the owner only)`);
  const period = parsePeriod(periodInput);
  const exp = now() + LINK_TTL;
  return { url: `${baseUrl}/exports/${file}?period=${encodeURIComponent(period.label)}&exp=${exp}&sig=${await sign(env, file, period.label, exp)}`, file, period: period.label, expires_at: exp };
}

export async function signedDownload(ctx: Ctx, file: string): Promise<Response> {
  const exp = Number(ctx.url.searchParams.get('exp'));
  const period = ctx.url.searchParams.get('period') ?? '';
  const sig = ctx.url.searchParams.get('sig') ?? '';
  const ok = isFile(file) && AGENT_EXPORT_FILES.includes(file) && exp > now() && exp <= now() + LINK_TTL + 60_000 && safeEqual(sig, await sign(ctx.env, file, period, exp));
  if (!ok) throw new AppError('NOT_FOUND', ctx.t('err.notFound'), 404);
  return send(ctx.env, ctx, file as ExportFile, period, 'signed-link');
}
