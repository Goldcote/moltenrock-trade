import { describe, expect, it } from 'vitest';
import { SEED_TIERS, suggestTemplate, TIER_TEMPLATES } from '../src/domain/tiers';

describe('price tiers', () => {
  it('seeds Standard −40 % (default) and VIP −50 %', () => {
    expect(SEED_TIERS).toEqual([{ name: 'Standard', discount_bp: 4000, is_default: 1 }, { name: 'VIP', discount_bp: 5000, is_default: 0 }]);
  });
  it('offers only generic B2B templates, none tied to an industry', () => {
    expect(TIER_TEMPLATES.map((t) => [t.key, t.name, t.discount_bp])).toEqual([['partner', 'Partner', 4500], ['distributor', 'Distributor', 5500]]);
    for (const type of ['hotel', 'pharmacy', 'salon', 'retail', 'other']) expect(suggestTemplate(type)).toBeNull();
  });
});
