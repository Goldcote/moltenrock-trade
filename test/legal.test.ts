import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/i18n';
import { legalDoc, type LegalVars } from '../src/legal/templates';
import { compareVersions, parseLatest } from '../src/lib/updates';

const vars: LegalVars = {
  shop: 'Alpenrose Handels AG', street: 'Musterstrasse 1', postcode: '8001', city: 'Zürich', email: 'trade@alpenrose.example',
  uid: 'CHE-123.456.788', vatRegistered: true, paymentDays: 14, minOrderRappen: 20_000, cancelMinutes: 30, approvalRappen: 500_000, emailProvider: null,
};
const text = (d: ReturnType<typeof legalDoc>) => [d.title, d.intro ?? '', ...d.sections.flatMap((s) => [s.h, ...s.p])].join('\n');

describe('built-in legal pages', () => {
  it('every language and page is complete: no placeholders left, shop details filled in', () => {
    for (const lang of LANGS) for (const kind of ['terms', 'privacy', 'imprint'] as const) {
      const t = text(legalDoc(kind, lang, vars));
      expect(t, `${lang} ${kind}`).not.toMatch(/\{\w+\}/);
      expect(t, `${lang} ${kind}`).toContain('Alpenrose Handels AG');
    }
  });

  it('terms follow the portal settings (payment days, minimum, approval, jurisdiction)', () => {
    const de = text(legalDoc('terms', 'de', vars));
    expect(de).toContain('innert 14 Tagen');
    expect(de).toMatch(/200\.00/);
    expect(de).toMatch(/5.000\.00/);
    expect(de).toContain('Gerichtsstand ist Zürich');
    expect(de).not.toContain('ß');
    expect(text(legalDoc('terms', 'en', { ...vars, approvalRappen: null }))).not.toContain('reviewed by');
    expect(text(legalDoc('terms', 'en', { ...vars, approvalRappen: 0 }))).toContain('Every order is reviewed');
    expect(text(legalDoc('terms', 'fr', { ...vars, vatRegistered: false }))).toContain('n’est pas assujetti à la TVA');
  });

  it('privacy notice names the email provider only when one is set up', () => {
    expect(text(legalDoc('privacy', 'en', vars))).not.toContain('Emails are sent via');
    expect(text(legalDoc('privacy', 'en', { ...vars, emailProvider: 'Resend' }))).toContain('Emails are sent via Resend.');
  });

  it('imprint shows the UID with the VAT suffix in each language', () => {
    expect(text(legalDoc('imprint', 'de', vars))).toContain('UID: CHE-123.456.788 MWST');
    expect(text(legalDoc('imprint', 'fr', vars))).toContain('TVA');
    expect(text(legalDoc('imprint', 'en', { ...vars, uid: null }))).not.toContain('UID');
  });
});

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.3.0')).toBe(-1);
  });
  it('accepts only a well-formed published file', () => {
    expect(parseLatest({ latest: '0.3.0', how_to_update_url: 'https://moltenrocktrade.com/update' }, 1)).toMatchObject({ latest: '0.3.0', how_to_update_url: 'https://moltenrocktrade.com/update' });
    expect(parseLatest({ latest: '0.3.0', notes_url: 'javascript:alert(1)' }, 1)?.notes_url).toBeUndefined();
    expect(parseLatest({ latest: 'latest!' }, 1)).toBeNull();
    expect(parseLatest('nope', 1)).toBeNull();
  });
});
