-- Customers who signed up on the website. You approve a sign-up, which
-- creates its license; then they can log in and download the app.
CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,           -- lower-cased
  password      TEXT NOT NULL,                  -- pbkdf2-sha256$<rounds>$<salt hex>$<hash hex>
  owner_name    TEXT NOT NULL,
  business_name TEXT NOT NULL,
  mobile        TEXT NOT NULL,
  city          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved
  license_id    TEXT REFERENCES licenses(id),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER,
  reset_hash    TEXT,                           -- sha256 of a one-time reset link's token
  reset_expires INTEGER,
  created_at    INTEGER NOT NULL
);

-- Logged-in browsers. Only the token's hash is kept.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);
