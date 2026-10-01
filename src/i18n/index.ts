import { de, type Dict } from './de';
import { en } from './en';
import { fr } from './fr';
import { it } from './it';

export const LANGS = ['de', 'fr', 'it', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export type MsgKey = keyof Dict;

const DICTS: Record<Lang, Dict> = { de, fr, it, en };

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Translate with {placeholder} substitution. Falls back to German, then to the key itself. */
export function t(lang: Lang, key: MsgKey, vars: Record<string, string | number> = {}): string {
  const template = DICTS[lang][key] ?? de[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export const translator = (lang: Lang) => (key: MsgKey, vars?: Record<string, string | number>) => t(lang, key, vars);

/** Parse Accept-Language with q-values and return the best supported language. */
export function fromAcceptLanguage(header: string | null): Lang | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { base: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((x) => x.base && !Number.isNaN(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const r of ranked) if (isLang(r.base)) return r.base;
  return null;
}

/** Order: explicit ?lang → cookie → signed-in partner's language → Accept-Language → shop default. */
export function negotiateLang(opts: { query?: string | null; cookie?: string | null; profile?: string | null; accept?: string | null; fallback: Lang }): Lang {
  for (const c of [opts.query, opts.cookie, opts.profile]) if (isLang(c)) return c;
  return fromAcceptLanguage(opts.accept ?? null) ?? opts.fallback;
}
