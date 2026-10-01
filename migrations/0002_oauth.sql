-- One-address agent connect: OAuth 2.1 (authorization code + PKCE) for MCP clients such as Claude.
-- The owner pastes the portal address into their agent, signs in here and clicks Allow; the agent
-- then receives an ordinary agent token (scoped, revocable on the merchant page).

CREATE TABLE oauth_clients (
  client_id          TEXT PRIMARY KEY,
  client_name        TEXT NOT NULL,
  redirect_uris      TEXT NOT NULL,
  secret_hash        TEXT,
  created_at         INTEGER NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash          TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri       TEXT NOT NULL,
  code_challenge     TEXT NOT NULL,
  scope              TEXT NOT NULL CHECK (scope IN ('read','operate','configure')),
  user_id            INTEGER NOT NULL REFERENCES users(id),
  expires_at         INTEGER NOT NULL,
  used_at            INTEGER,
  token_id           INTEGER
);

ALTER TABLE agent_tokens ADD COLUMN oauth_client_id TEXT;
