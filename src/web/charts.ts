// Server-rendered SVG charts. No inline styles or scripts (strict CSP): geometry lives in SVG
// attributes, colour and motion in styles.css (bars grow, lines draw, rings fill — all CSS).

import { html, raw, type Html } from '../lib/html';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Weekly bars with gridlines, an average line and hover labels. */
export function barChart(points: { label: string; value: number; display: string }[], opts: { avgLabel?: string; axis: (v: number) => string }): Html {
  const W = 640, H = 220, padL = 44, padR = 8, padT = 16, padB = 28;
  const max = Math.max(1, ...points.map((p) => p.value));
  const nice = niceMax(max);
  const cw = (W - padL - padR) / Math.max(1, points.length);
  const bw = Math.min(34, cw * 0.62);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const avg = points.length ? points.reduce((a, p) => a + p.value, 0) / points.length : 0;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => nice * f);
  return html`<svg class="chart bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${points.map((p) => `${p.label}: ${p.display}`).join(', ')}">
    <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/></linearGradient></defs>
    ${grid.map((g) => html`<line class="grid" x1="${padL}" x2="${W - padR}" y1="${r1(y(g))}" y2="${r1(y(g))}"/><text class="axis" x="${padL - 8}" y="${r1(y(g) + 4)}" text-anchor="end">${opts.axis(g)}</text>`)}
    <g class="bar-set">${points.map((p, i) => {
      const x = padL + cw * i + (cw - bw) / 2;
      const top = y(p.value);
      const h = Math.max(p.value > 0 ? 2 : 0, H - padB - top);
      return html`<g class="bar${i === points.length - 1 ? ' current' : ''}" tabindex="0"><rect class="hit" x="${r1(padL + cw * i)}" y="${padT}" width="${r1(cw)}" height="${H - padT - padB}"/>
        <rect class="fill" x="${r1(x)}" y="${r1(H - padB - h)}" width="${r1(bw)}" height="${r1(h)}" rx="5"/>
        <text class="tip" x="${r1(x + bw / 2)}" y="${r1(Math.max(12, H - padB - h - 8))}" text-anchor="middle">${p.display}</text>
        <text class="axis x" x="${r1(x + bw / 2)}" y="${H - 8}" text-anchor="middle">${p.label}</text></g>`;
    })}</g>
    ${avg > 0 ? html`<line class="avg" x1="${padL}" x2="${W - padR}" y1="${r1(y(avg))}" y2="${r1(y(avg))}"/>${opts.avgLabel ? html`<text class="avg-label" x="${W - padR}" y="${r1(y(avg) - 6)}" text-anchor="end">${opts.avgLabel}</text>` : ''}` : ''}
  </svg>`;
}

/** A small trend line for a KPI card (draws itself in). */
export function sparkline(values: number[]): Html {
  if (values.length < 2) return html``;
  const W = 120, H = 36;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const pts = values.map((v, i) => [r1((i / (values.length - 1)) * W), r1(H - 3 - ((v - min) / (max - min || 1)) * (H - 6))] as const);
  const d = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x} ${yy}`).join(' ');
  const area = `${d} L${W} ${H} L0 ${H} Z`;
  const [lx, ly] = pts[pts.length - 1]!;
  return html`<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true" preserveAspectRatio="none"><path class="spark-area" d="${area}"/><path class="spark-line" d="${d}" pathLength="1"/><circle class="spark-dot" cx="${lx}" cy="${ly}" r="3"/></svg>`;
}

/** Donut with segments (fractions of 100 via pathLength), drawn in sequence. */
export function donut(segments: { value: number; cls: string }[], center: { big: string; small: string }): Html {
  const total = segments.reduce((a, s) => a + s.value, 0);
  let offset = 0;
  const arcs = total > 0 ? segments.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * 100;
    const gap = segments.filter((x) => x.value > 0).length > 1 ? 1.2 : 0;
    const el = html`<circle class="seg ${s.cls}" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${r1(Math.max(0.1, len - gap))} ${r1(100 - Math.max(0.1, len - gap))}" stroke-dashoffset="${r1(-offset)}" transform="rotate(-90 60 60)"/>`;
    offset += len;
    return el;
  }) : [];
  return html`<svg class="donut" viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="48"/>${arcs}
    <text class="donut-big" x="60" y="60" text-anchor="middle">${center.big}</text><text class="donut-small" x="60" y="78" text-anchor="middle">${center.small}</text></svg>`;
}

/** A single progress ring (0–1) with a label inside. */
export function ring(fraction: number, label: string, cls = ''): Html {
  const f = Math.max(0, Math.min(1, fraction));
  return html`<svg class="ring ${cls}" viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="26"/>
    <circle class="val${f >= 1 ? ' full' : ''}" cx="32" cy="32" r="26" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${r1(100 - f * 100)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle">${label}</text></svg>`;
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// Line icons for the console (24px, stroke = currentColor).
const ICONS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/>',
  approvals: '<path d="M9 12.5l2 2 4-4.5"/><path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6z"/>',
  setup: '<path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3"/><circle cx="12" cy="12" r="4"/>',
  status: '<path d="M4 19V5M4 19h16"/><path d="M8 15l3.5-4 3 2.5L20 7"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 01-5.3 1.9A3 3 0 0112 14a3 3 0 01-2.7-1.1A3 3 0 014 11z"/><path d="M5.5 13.5V20h13v-6.5"/>',
  logout: '<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  agent: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  partner: '<path d="M3 20V9l9-5 9 5v11"/><path d="M9 20v-6h6v6"/>',
  order: '<path d="M6 3h12l-1 18H7z"/><path d="M9 7h6M9 11h6"/>',
  spark: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  mac: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

export const icon = (name: keyof typeof ICONS | string, cls = 'ic'): Html =>
  raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`);
