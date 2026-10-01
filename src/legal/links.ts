import type { Settings } from '../domain/settings';

export type LegalPage = 'terms' | 'privacy' | 'imprint';

/** Where a legal link points: the merchant's own page if set, otherwise the built-in page. */
export function legalHref(s: Settings, kind: LegalPage): string {
  if (kind === 'terms' && s.legal_terms_url) return s.legal_terms_url;
  if (kind === 'privacy' && s.legal_privacy_url) return s.legal_privacy_url;
  return `/legal/${kind}`;
}
