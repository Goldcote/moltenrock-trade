import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { it as itDict } from '../src/i18n/it';
import { fromAcceptLanguage, negotiateLang, t } from '../src/i18n';
import { escapeHtml, html, raw } from '../src/lib/html';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('every language has every key with the same placeholders and no empty strings', () => {
    for (const [name, dict] of Object.entries({ fr, it: itDict, en })) {
      for (const key of Object.keys(de) as (keyof typeof de)[]) {
        const v = (dict as Record<string, string>)[key];
        expect(v, `${name}.${key}`).toBeTruthy();
        expect(placeholders(v as string), `${name}.${key}`).toEqual(placeholders(de[key]));
      }
    }
  });
  it('Swiss German never uses ß', () => {
    expect(Object.values(de).join(' ')).not.toContain('ß');
  });
  it('substitutes placeholders', () => {
    expect(t('fr', 'cart.vat', { rate: '8.1' })).toBe('TVA 8.1 %');
  });
});

describe('language negotiation', () => {
  it('parses Accept-Language q-values', () => {
    expect(fromAcceptLanguage('fr-CH,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(fromAcceptLanguage('es,it;q=0.5,de;q=0.4')).toBe('it');
    expect(fromAcceptLanguage('es')).toBeNull();
  });
  it('prefers explicit choice, then cookie, then profile, then browser, then shop default', () => {
    expect(negotiateLang({ query: 'it', cookie: 'fr', accept: 'en', fallback: 'de' })).toBe('it');
    expect(negotiateLang({ query: 'xx', cookie: 'fr', accept: 'en', fallback: 'de' })).toBe('fr');
    expect(negotiateLang({ profile: 'en', fallback: 'de' })).toBe('en');
    expect(negotiateLang({ accept: 'es', fallback: 'de' })).toBe('de');
  });
});

describe('html escaping', () => {
  it('escapes interpolated values but not nested templates', () => {
    const name = '<script>alert("x")</script>';
    expect(html`<b>${name}</b>`.value).toBe('<b>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</b>');
    expect(html`<p>${html`<i>${'a&b'}</i>`}</p>`.value).toBe('<p><i>a&amp;b</i></p>');
    expect(html`${[1, '<', raw('<br>')]}`.value).toBe('1&lt;<br>');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
});
