// MoltenView (Mac app): a ready-to-push view of the portal. MoltenRock Trade never talks to the Mac
// itself — the owner's agent, running on that Mac, fetches this payload with get_moltenview_view
// and pushes it (moltenview_push tool, or the MoltenView Unix socket). Read-only; no personal data
// beyond company names and order totals the owner already sees.

import type { Lang } from '../i18n';
import type { Env } from '../lib/env';
import { formatMoney } from '../money/format';
import { all, one } from '../domain/db';
import { getShop } from '../domain/settings';
import { overview, setupStatus } from '../domain/status';
import { countPricesToConfirm } from '../domain/catalog';

const STATE_BADGE: Record<string, { badge: string; style: string }> = {
  awaiting_approval: { badge: 'Needs approval', style: 'warning' },
  cancel_window: { badge: 'Received', style: 'info' },
  confirmed: { badge: 'Confirmed', style: 'success' },
  cancelled: { badge: 'Cancelled', style: 'neutral' },
  rejected: { badge: 'Declined', style: 'neutral' },
};

export async function moltenViewPayload(env: Env, baseUrl: string) {
  const shop = await getShop(env.DB);
  const lang: Lang = shop?.default_lang ?? 'de';
  const money = (r: number | null | undefined) => formatMoney(r ?? 0, lang);
  const [o, setup] = await Promise.all([overview(env), setupStatus(env, baseUrl)]);
  const pendingPartners = await all<{ id: number; company: string; city: string }>(env.DB, "SELECT id, company, city FROM partners WHERE status = 'pending' ORDER BY id LIMIT 10");
  const held = await all<{ ref: string; total_rappen: number; company: string }>(env.DB,
    "SELECT o.ref, o.total_rappen, p.company FROM orders o JOIN partners p ON p.id = o.partner_id WHERE o.state = 'awaiting_approval' ORDER BY o.id LIMIT 10");
  const month = await one<{ n: number; total: number }>(env.DB,
    "SELECT COUNT(*) AS n, COALESCE(SUM(total_rappen), 0) AS total FROM orders WHERE state = 'confirmed' AND confirmed_at >= ?", Date.parse(new Date().toISOString().slice(0, 8) + '01T00:00:00Z'));
  const prices = await countPricesToConfirm(env.DB);
  const approvalsUrl = `${baseUrl}/merchant/approvals`;
  const needs = pendingPartners.length + held.length + o.open_proposals + (prices ? 1 : 0);
  const stepsDone = setup.steps.filter((s) => s.done).length;

  const sections: Record<string, unknown>[] = [
    {
      id: 'kpis', header: 'Today', columns: 4,
      items: [
        { id: 'k-needs', type: 'metric', title: 'Waiting for you', subtitle: String(needs), detail: needs ? 'Open Approvals to decide' : 'Nothing to decide', metricColor: needs ? '#D9481C' : '#1F7A4D' },
        { id: 'k-month', type: 'metric', title: 'Confirmed this month', subtitle: money(month?.total), detail: `${month?.n ?? 0} orders` },
        { id: 'k-open', type: 'metric', title: 'Open invoices', subtitle: money(o.invoices?.open_total), detail: `${o.invoices?.open_n ?? 0} open · ${o.invoices?.overdue_n ?? 0} overdue`, ...(o.invoices?.overdue_n ? { metricColor: '#B42318' } : {}) },
        { id: 'k-partners', type: 'metric', title: 'Trade customers', subtitle: String(o.partners.approved ?? 0), detail: `${o.partners.pending ?? 0} applying` },
      ],
    },
  ];
  if (needs) {
    sections.push({
      id: 'needs', header: 'Waiting for your decision',
      items: [
        ...pendingPartners.map((p) => ({ id: `p-${p.id}`, title: p.company, subtitle: `New trade account · ${p.city}`, badge: 'Approve?', badgeStyle: 'warning' })),
        ...held.map((h) => ({ id: `o-${h.ref}`, title: `${h.ref} · ${h.company}`, subtitle: `Order above your approval amount · ${money(h.total_rappen)}`, badge: 'Approve?', badgeStyle: 'warning' })),
        ...(prices ? [{ id: 'prices', title: `${prices} price(s) to confirm`, subtitle: 'Found by your agent on your website · not orderable until you confirm', badge: 'Check', badgeStyle: 'warning' }] : []),
        ...(o.open_proposals ? [{ id: 'proposals', title: `${o.open_proposals} proposal(s) from your agent`, subtitle: 'Confirm or decline', badge: 'Review', badgeStyle: 'info' }] : []),
        ...(approvalsUrl.startsWith('https://') ? [{ id: 'approvals-link', type: 'link', title: 'Open Approvals', url: approvalsUrl }] : []),
      ],
    });
  }
  if (o.recent_orders.length) {
    sections.push({
      id: 'orders', header: 'Latest orders',
      items: (o.recent_orders as { ref: string; state: string; total_rappen: number; company: string }[]).slice(0, 8).map((r) => ({
        id: `r-${r.ref}`, title: `${r.ref} · ${r.company}`, subtitle: money(r.total_rappen), ...(STATE_BADGE[r.state] ? { badge: STATE_BADGE[r.state]!.badge, badgeStyle: STATE_BADGE[r.state]!.style } : {}),
      })),
    });
  }
  const cov = o.catalog.translations;
  sections.push({
    id: 'setup', header: stepsDone === setup.steps.length ? 'Portal' : 'Setup', columns: 2,
    items: [
      { id: 'setup-steps', type: 'progress', title: 'Setup', progress: setup.steps.length ? stepsDone / setup.steps.length : 0, subtitle: `${stepsDone} of ${setup.steps.length} steps` },
      { id: 'catalogue', type: 'progress', title: 'Product texts DE · FR · IT · EN', progress: cov.products ? Object.values(cov.by_lang).reduce((a, l) => a + l.present, 0) / (cov.products * 4) : 0, subtitle: `${o.catalog.orderable ?? 0} products orderable` },
    ],
  });
  return {
    title: `${shop?.legal_name ?? 'MoltenRock Trade'} · Trade portal`,
    source: 'MoltenRock Trade',
    sections,
  };
}
