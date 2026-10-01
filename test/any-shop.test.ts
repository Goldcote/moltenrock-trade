import { describe, expect, it } from 'vitest';
import { orderableReason, planAgentUpdate, type ProductRow } from '../src/domain/catalog';
import { DEFAULT_SETTINGS } from '../src/domain/settings';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { it as itMsgs } from '../src/i18n/it';

const DAY = 86_400_000;
const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: 1, source: 'agent', source_id: 'https://shop.example/p/towel', parent_source_id: null, sku: 'LT-1',
  price_rappen: 1890, prices_include_tax: 1, vat_code: 'standard', image_url: '', stock_status: 'instock',
  included: 1, unpriceable: 0, flag_reason: '', carton_multiple: null, min_qty: null, sort: 0,
  source_url: 'https://shop.example/p/towel', price_confirmed_at: null,
  proposed_price_rappen: null, proposed_prices_include_tax: null, proposed_vat_code: null, proposed_at: null, ...over,
});
const same = { price: 1890, pit: 1, vat: 'standard' };

describe('any shop: products the agent read on a website', () => {
  it('are not orderable until a person confirmed the price', () => {
    expect(orderableReason(product(), DEFAULT_SETTINGS)).toBe('waiting for its price to be confirmed');
    expect(orderableReason(product({ price_confirmed_at: Date.now() }), DEFAULT_SETTINGS)).toBeNull();
  });

  it('leave imported WooCommerce products alone', () => {
    expect(orderableReason(product({ source: 'woocommerce' }), DEFAULT_SETTINGS)).toBeNull();
  });

  it('keep a product without a price out of the catalogue', () => {
    expect(orderableReason(product({ unpriceable: 1, included: 0, flag_reason: 'no price found', price_confirmed_at: Date.now() }), DEFAULT_SETTINGS)).toBe('not priceable');
  });
});

describe('the agent reading a product again', () => {
  it('only refreshes a price nobody confirmed yet (it still waits)', () => {
    expect(planAgentUpdate(product(), { ...same, price: 1990 })).toBe('refresh_unconfirmed');
    expect(planAgentUpdate(product(), same)).toBe('refresh_unconfirmed');
  });

  it('turns a different price for a confirmed product into a proposal; the confirmed price stays', () => {
    const confirmed = product({ price_confirmed_at: Date.now() - 6 * DAY });
    expect(planAgentUpdate(confirmed, { ...same, price: 2090 })).toBe('propose_change');
    expect(planAgentUpdate(confirmed, { ...same, pit: 0 })).toBe('propose_change');
    expect(planAgentUpdate(confirmed, { ...same, vat: 'reduced' })).toBe('propose_change');
    expect(planAgentUpdate(confirmed, same)).toBe('unchanged');
  });

  it('sets a product aside when the price has disappeared from the page', () => {
    expect(planAgentUpdate(product({ price_confirmed_at: Date.now() }), { ...same, price: null })).toBe('set_aside');
  });

  it('asks for confirmation again when a vanished price comes back', () => {
    const setAside = product({ price_confirmed_at: Date.now() - DAY, unpriceable: 1, included: 0, flag_reason: 'no price found' });
    expect(planAgentUpdate(setAside, same)).toBe('refresh_unconfirmed');
  });

  it('never brings back a product whose price the owner declined', () => {
    const declined = product({ unpriceable: 1, included: 0, flag_reason: 'price declined by the owner' });
    expect(planAgentUpdate(declined, same)).toBe('keep_declined');
    expect(planAgentUpdate(declined, { ...same, price: null })).toBe('keep_declined');
  });
});

describe('setup instructions for the agent', () => {
  it('cover WooCommerce and any other shop in every language, and never let the agent confirm prices', () => {
    for (const d of [de, fr, itMsgs, en]) {
      const prompt = d['m.step3.prompt'];
      expect(prompt).toContain('WooCommerce');
      expect(prompt).toContain('upsert_products');
      expect(prompt).toContain('Shopify');
    }
  });
});
