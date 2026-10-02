import { describe, expect, it } from 'vitest';
import { validateShopIdentity, type ShopIdentityInput } from '../src/domain/settings';

const base: ShopIdentityInput = { legal_name: 'Alpenrose Handels AG', street: 'Musterstrasse', house_no: '1', postcode: '8001', city: 'Zürich', email: 'owner@example.test', uid: '', vat_registered: false, iban: '' };

describe('company and bank details at sign-up', () => {
  it('accept no IBAN yet (it can follow later)', () => {
    expect(validateShopIdentity(base).iban).toBe('');
  });
  it('accept spaces, dashes and lower case in an IBAN', () => {
    expect(validateShopIdentity({ ...base, iban: 'ch93-0076-2011 6238 5295 7' }).iban).toBe('CH9300762011623852957');
  });
  it('refuse an invalid or non-Swiss IBAN', () => {
    expect(() => validateShopIdentity({ ...base, iban: 'CH2424242424242' })).toThrow(expect.objectContaining({ code: 'INVALID_IBAN' }));
    expect(() => validateShopIdentity({ ...base, iban: 'DE89 3704 0044 0532 0130 00' })).toThrow(expect.objectContaining({ code: 'INVALID_IBAN' }));
  });
  it('never remove an IBAN once set (invoices depend on it)', () => {
    expect(() => validateShopIdentity(base, { requireIban: true })).toThrow(expect.objectContaining({ code: 'IBAN_REQUIRED' }));
    expect(validateShopIdentity({ ...base, iban: 'CH93 0076 2011 6238 5295 7' }, { requireIban: true }).iban).toBe('CH9300762011623852957');
  });
});
