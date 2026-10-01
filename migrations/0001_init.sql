-- MoltenRock Trade schema (Cloudflare D1 / SQLite).
-- Conventions: money is INTEGER rappen (1/100 CHF); discounts are INTEGER basis points (4000 = 40%);
-- VAT rates are INTEGER basis points of percent (810 = 8.1%); timestamps are INTEGER unix milliseconds.
-- Production: create the database with `--jurisdiction eu` so all of this is stored in the EU.

-- The single shop this instance serves (single shop per instance). Identity + bank details are HUMAN-ONLY:
-- agents can read them but never change them.
CREATE TABLE shop (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  legal_name      TEXT NOT NULL,
  street          TEXT NOT NULL,
  house_no        TEXT NOT NULL DEFAULT '',
  postcode        TEXT NOT NULL,
  city            TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT 'CH',
  email           TEXT NOT NULL,              -- B2B inbox: receives order copies
  uid             TEXT,                       -- CHE-123.456.789
  vat_registered  INTEGER NOT NULL DEFAULT 0,
  iban            TEXT,                       -- normal IBAN (SCOR) or QR-IBAN (QRR); NULL until entered
  default_lang    TEXT NOT NULL DEFAULT 'de',
  currency        TEXT NOT NULL DEFAULT 'CHF',
  created_at      INTEGER NOT NULL
);

-- Agent/merchant-configurable settings (the locked defaults). Key → JSON value.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL
);

-- Merchant people (owner/staff). Buyers live in partner_users.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL CHECK (role IN ('owner','staff')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE tiers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  discount_bp  INTEGER NOT NULL CHECK (discount_bp BETWEEN 0 AND 9900),
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

-- Trade customers (companies).
CREATE TABLE partners (
  id                  INTEGER PRIMARY KEY,
  company             TEXT NOT NULL,
  contact_name        TEXT NOT NULL,
  email               TEXT NOT NULL COLLATE NOCASE,
  phone               TEXT NOT NULL DEFAULT '',
  street              TEXT NOT NULL DEFAULT '',
  house_no            TEXT NOT NULL DEFAULT '',
  postcode            TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT '',
  country             TEXT NOT NULL DEFAULT 'CH',
  uid                 TEXT,
  uid_check           TEXT NOT NULL DEFAULT 'unchecked',   -- unchecked | format_ok | invalid
  language            TEXT NOT NULL DEFAULT 'de',
  business_type       TEXT NOT NULL DEFAULT '',
  tier_id             INTEGER REFERENCES tiers(id),
  status              TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','suspended')),
  invited             INTEGER NOT NULL DEFAULT 0,
  min_order_rappen    INTEGER,          -- per-partner override (NULL = shop setting)
  payment_terms_days  INTEGER,          -- per-partner override (NULL = shop setting)
  prepayment          INTEGER NOT NULL DEFAULT 0,
  trusted             INTEGER NOT NULL DEFAULT 0,   -- trusted partners skip the basket approval threshold
  terms_accepted_at   INTEGER,
  created_at          INTEGER NOT NULL,
  decided_at          INTEGER
);
CREATE INDEX partners_status ON partners(status);

CREATE TABLE partner_users (
  id          INTEGER PRIMARY KEY,
  partner_id  INTEGER NOT NULL REFERENCES partners(id),
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- Human sessions (merchant users and partner users). Cookie holds the random id; we store its hash.
CREATE TABLE sessions (
  id_hash       TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('user','partner_user')),
  subject_id    INTEGER NOT NULL,
  csrf          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

-- Magic login links. Only an HMAC of the token is stored; single use; short-lived.
CREATE TABLE magic_links (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

-- Fixed-window rate limiting, incremented atomically with a single upsert.
CREATE TABLE rate_limits (
  bucket        TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);

-- Connection to the merchant's existing shop (read-only key, encrypted at rest).
CREATE TABLE shop_connection (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  kind                TEXT NOT NULL CHECK (kind IN ('woocommerce','shopify')),
  base_url            TEXT NOT NULL,
  key_enc             TEXT NOT NULL,
  secret_enc          TEXT NOT NULL,
  prices_include_tax  INTEGER NOT NULL DEFAULT 1,
  connected_at        INTEGER NOT NULL,
  last_import_at      INTEGER,
  last_import_summary TEXT
);

-- Orderable items (simple products and variations). Prices are the shop's raw list price.
CREATE TABLE products (
  id                  INTEGER PRIMARY KEY,
  source              TEXT NOT NULL,             -- 'woocommerce' | 'manual'
  source_id           TEXT NOT NULL,             -- canonical id in the source shop
  parent_source_id    TEXT,                      -- for variations
  sku                 TEXT NOT NULL DEFAULT '',
  price_rappen        INTEGER NOT NULL,          -- raw list price (gross if prices_include_tax)
  prices_include_tax  INTEGER NOT NULL DEFAULT 1,
  vat_code            TEXT NOT NULL DEFAULT 'standard' CHECK (vat_code IN ('standard','reduced','accommodation','zero')),
  image_url           TEXT NOT NULL DEFAULT '',
  stock_status        TEXT NOT NULL DEFAULT 'instock',
  included            INTEGER NOT NULL DEFAULT 1,
  unpriceable         INTEGER NOT NULL DEFAULT 0,
  flag_reason         TEXT NOT NULL DEFAULT '',
  carton_multiple     INTEGER,                   -- NULL = any quantity
  min_qty             INTEGER,                   -- NULL = 1
  sort                INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL,
  UNIQUE (source, source_id)
);

-- Per-language product content with provenance: imported (from the shop), agent (written by the
-- merchant's AI agent) or human (written/edited by a person).
CREATE TABLE product_translations (
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lang         TEXT NOT NULL CHECK (lang IN ('de','fr','it','en')),
  name         TEXT NOT NULL,
  short_desc   TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  unit_text    TEXT NOT NULL DEFAULT '',
  provenance   TEXT NOT NULL CHECK (provenance IN ('imported','agent','human')),
  updated_by   TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (product_id, lang)
);

-- Swiss VAT rates with validity windows (basis points of percent).
CREATE TABLE vat_rates (
  code        TEXT NOT NULL,
  rate_bp     INTEGER NOT NULL,
  valid_from  TEXT NOT NULL,     -- YYYY-MM-DD inclusive
  valid_to    TEXT,              -- YYYY-MM-DD exclusive, NULL = open
  PRIMARY KEY (code, valid_from)
);

-- Server-side cart: only product ids and quantities are ever stored or accepted.
CREATE TABLE cart_items (
  partner_id  INTEGER NOT NULL REFERENCES partners(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 999),
  PRIMARY KEY (partner_id, product_id)
);

CREATE TABLE orders (
  id                   INTEGER PRIMARY KEY,
  ref                  TEXT NOT NULL UNIQUE,      -- human-readable reference, e.g. MT-7F3K9Q
  partner_id           INTEGER NOT NULL REFERENCES partners(id),
  placed_by            INTEGER NOT NULL REFERENCES partner_users(id),
  state                TEXT NOT NULL CHECK (state IN ('awaiting_approval','cancel_window','confirmed','cancelled','rejected')),
  po_number            TEXT NOT NULL DEFAULT '',
  ship_mode            TEXT NOT NULL CHECK (ship_mode IN ('delivery','pickup')),
  ship_to              TEXT NOT NULL,             -- JSON structured address
  note                 TEXT NOT NULL DEFAULT '',
  language             TEXT NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'CHF',
  subtotal_net_rappen  INTEGER NOT NULL,
  vat_rappen           INTEGER NOT NULL,
  total_rappen         INTEGER NOT NULL,
  pricing_snapshot     TEXT NOT NULL,             -- JSON: immutable pricing at submission
  created_at           INTEGER NOT NULL,
  approved_at          INTEGER,
  approved_by          TEXT,
  confirm_after        INTEGER,                   -- end of the partner's cancel window
  confirmed_at         INTEGER,
  cancelled_at         INTEGER,
  decided_reason       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX orders_partner ON orders(partner_id, created_at);
CREATE INDEX orders_state ON orders(state, confirm_after);

CREATE TABLE order_lines (
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  line_no          INTEGER NOT NULL,
  product_id       INTEGER NOT NULL,
  source_id        TEXT NOT NULL,
  sku              TEXT NOT NULL,
  name             TEXT NOT NULL,
  qty              INTEGER NOT NULL,
  unit_net_rappen  INTEGER NOT NULL,
  line_net_rappen  INTEGER NOT NULL,
  vat_code         TEXT NOT NULL,
  vat_rate_bp      INTEGER NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

-- Things an agent wants done that need a human's confirmation.
CREATE TABLE proposals (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('partner_decision','basket_decision','credit_note')),
  target_id    INTEGER NOT NULL,
  payload      TEXT NOT NULL,     -- JSON
  reason       TEXT NOT NULL DEFAULT '',
  proposed_by  TEXT NOT NULL,     -- 'agent:<name>'
  status       TEXT NOT NULL CHECK (status IN ('open','confirmed','rejected','superseded')),
  decided_by   TEXT,
  decided_at   INTEGER,
  result       TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX proposals_status ON proposals(status, created_at);

CREATE TABLE agent_tokens (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  scope         TEXT NOT NULL CHECK (scope IN ('read','operate','configure')),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER
);

-- Idempotent replays of agent writes (per token + key).
CREATE TABLE idempotency (
  token_id      INTEGER NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response      TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (token_id, key)
);

-- Invoices and credit notes, each in its own gapless series.
CREATE TABLE counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);

CREATE TABLE invoices (
  id                  INTEGER PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('invoice','credit_note')),
  number              INTEGER NOT NULL,
  order_id            INTEGER NOT NULL REFERENCES orders(id),
  related_invoice_id  INTEGER REFERENCES invoices(id),
  partner_id          INTEGER NOT NULL REFERENCES partners(id),
  issue_date          TEXT NOT NULL,     -- YYYY-MM-DD
  due_date            TEXT,
  language            TEXT NOT NULL,
  currency            TEXT NOT NULL,
  net_rappen          INTEGER NOT NULL,
  vat_rappen          INTEGER NOT NULL,
  total_rappen        INTEGER NOT NULL,
  vat_breakdown       TEXT NOT NULL,     -- JSON [{rate_bp, net_rappen, vat_rappen}]
  reference           TEXT NOT NULL DEFAULT '',   -- SCOR / QRR payment reference
  status              TEXT NOT NULL CHECK (status IN ('open','paid','credited','issued')),
  paid_at             INTEGER,
  pdf                 BLOB,
  pdf_sha256          TEXT,
  created_at          INTEGER NOT NULL,
  UNIQUE (kind, number)
);

-- Fulfilment hand-offs. In this prototype every row is a DRY RUN: built and stored, never sent.
CREATE TABLE integration_outbox (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  profile     TEXT NOT NULL,
  target      TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('dry_run')),
  created_at  INTEGER NOT NULL
);

-- Local development mailbox (no real email is ever sent by the prototype).
CREATE TABLE outbox_emails (
  id          INTEGER PRIMARY KEY,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Append-only audit log. actor_type: user | partner | agent | system.
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  at           INTEGER NOT NULL,
  actor_type   TEXT NOT NULL,
  actor_label  TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '{}'
);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- Seed data every instance needs.
INSERT INTO counters (name, value) VALUES ('invoice', 0), ('credit_note', 0);
INSERT INTO vat_rates (code, rate_bp, valid_from, valid_to) VALUES
  ('standard',      810, '2024-01-01', NULL),
  ('reduced',       260, '2024-01-01', NULL),
  ('accommodation', 380, '2024-01-01', NULL),
  ('zero',            0, '2000-01-01', NULL);
