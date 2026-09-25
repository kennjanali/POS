-- One row per license sold.
CREATE TABLE licenses (
  id            TEXT PRIMARY KEY,               -- LIC-2026-0001
  key           TEXT NOT NULL UNIQUE,           -- XXXX-XXXX-XXXX-XXXX, given to the customer
  business_name TEXT NOT NULL,
  city          TEXT NOT NULL DEFAULT '',
  plan          TEXT NOT NULL DEFAULT 'standard',
  updates_until TEXT NOT NULL,                  -- YYYY-MM-DD
  status        TEXT NOT NULL DEFAULT 'active', -- active | revoked
  notes         TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

-- Which install on which tablet holds a license. One open row per license;
-- moving to a new tablet closes the old row.
CREATE TABLE activations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id   TEXT NOT NULL REFERENCES licenses(id),
  install_id   TEXT NOT NULL,
  device       TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  released_at  INTEGER
);
CREATE INDEX activations_license ON activations(license_id);

-- The latest heartbeat per install.
CREATE TABLE heartbeats (
  install_id     TEXT PRIMARY KEY,
  license_id     TEXT NOT NULL,
  app_version    TEXT,
  os             TEXT,
  model          TEXT,
  last_backup_at INTEGER,
  error_count    INTEGER,
  printer_ok     INTEGER,
  seen_at        INTEGER NOT NULL
);

-- Daily closes as reported by each install: the technology fee's base.
-- `linked` is 0 when a close does not chain onto the one before it.
CREATE TABLE closes (
  install_id        TEXT NOT NULL,
  no                INTEGER NOT NULL,
  license_id        TEXT NOT NULL,
  date              TEXT NOT NULL,
  closed_at         INTEGER NOT NULL,
  orders            INTEGER NOT NULL,
  net_cents         INTEGER NOT NULL,
  running_net_cents INTEGER NOT NULL,
  hash              TEXT NOT NULL,
  linked            INTEGER NOT NULL,
  received_at       INTEGER NOT NULL,
  PRIMARY KEY (install_id, no)
);
CREATE INDEX closes_license_date ON closes(license_id, date);

-- Technology fee payments, entered by hand (GCash / bank transfer).
CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id   TEXT NOT NULL REFERENCES licenses(id),
  month        TEXT NOT NULL,                   -- YYYY-MM the payment is for
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL,                   -- gcash | bank | other
  ref          TEXT NOT NULL DEFAULT '',
  paid_at      INTEGER NOT NULL
);
CREATE INDEX payments_license ON payments(license_id);
