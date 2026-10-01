// Auto-escaping HTML templates. Every interpolated value is escaped unless it is itself an
// `Html` value produced by `html` / `raw` — so product names written by an agent or a buyer can
// never inject markup.

export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

type Part = Html | string | number | boolean | null | undefined | Part[];

const render = (v: Part): string => {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return '';
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(String(v));
};

export function html(strings: TemplateStringsArray, ...values: Part[]): Html {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i] as Part);
  });
  return new Html(out);
}

/** Trusted markup only (e.g. our own static SVG). Never pass user or agent input here. */
export const raw = (s: string): Html => new Html(s);
