import type { Lang } from '../i18n';

const LOCALE: Record<Lang, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-CH' };

/** "CHF 1’234.50" in the viewer's Swiss locale. */
export function formatMoney(rappen: number, lang: Lang, currency = 'CHF'): string {
  return new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency, minimumFractionDigits: 2 }).format(rappen / 100);
}

/** Plain "1234.50" (QR-bill amount field, JSON). */
export const rappenToDecimal = (rappen: number): string => {
  const neg = rappen < 0;
  const a = Math.abs(rappen);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

/** 810 → "8.1" */
export const bpToPercent = (bp: number): string => (bp / 100).toFixed(2).replace(/\.?0+$/, '');

export function formatDate(ms: number | string, lang: Lang): string {
  const d = typeof ms === 'string' ? new Date(ms + 'T00:00:00Z') : new Date(ms);
  return new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Zurich' }).format(d);
}

export const isoDate = (ms: number): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
