-- Any shop: products can come from the merchant's website, a spreadsheet or a product feed, added
-- by their agent (source 'agent'). Prices an agent found only count once a person confirmed them;
-- a changed price waits next to the confirmed one until it is confirmed too.
ALTER TABLE products ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN price_confirmed_at INTEGER;
ALTER TABLE products ADD COLUMN proposed_price_rappen INTEGER;
ALTER TABLE products ADD COLUMN proposed_prices_include_tax INTEGER;
ALTER TABLE products ADD COLUMN proposed_vat_code TEXT;
ALTER TABLE products ADD COLUMN proposed_at INTEGER;
