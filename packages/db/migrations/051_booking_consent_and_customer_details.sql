-- Migration 051: configurable booking consent and customer-entered details.
--
-- The current consent text is managed per LINE account. Every booking keeps a
-- snapshot of the exact title/body/version accepted by the customer so later
-- edits do not rewrite historical consent evidence.

CREATE TABLE IF NOT EXISTS booking_consent_settings (
  line_account_id TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  is_required     INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

ALTER TABLE bookings ADD COLUMN customer_name TEXT;
ALTER TABLE bookings ADD COLUMN customer_kana TEXT;
ALTER TABLE bookings ADD COLUMN customer_phone TEXT;
ALTER TABLE bookings ADD COLUMN consent_title TEXT;
ALTER TABLE bookings ADD COLUMN consent_body TEXT;
ALTER TABLE bookings ADD COLUMN consent_version INTEGER;
ALTER TABLE bookings ADD COLUMN consent_agreed_at TEXT;
