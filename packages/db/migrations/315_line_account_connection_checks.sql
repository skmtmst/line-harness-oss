-- V6 feature 33: optimistic versioning and persisted LINE connection checks.

ALTER TABLE line_accounts
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE line_account_connection_checks (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  check_kind        TEXT NOT NULL CHECK (check_kind IN (
    'bot_info', 'webhook_endpoint', 'webhook_test', 'liff_config', 'token_refresh'
  )),
  result            TEXT NOT NULL CHECK (result IN (
    'matched', 'mismatched', 'unconfigured', 'unknown', 'ok', 'failed'
  )),
  expected_url      TEXT,
  registered_url    TEXT,
  webhook_active    INTEGER CHECK (webhook_active IN (0, 1) OR webhook_active IS NULL),
  http_status       INTEGER,
  checked_by        TEXT NOT NULL,
  checked_at        TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  account_revision  INTEGER NOT NULL,
  UNIQUE (line_account_id, idempotency_key, check_kind)
);

CREATE INDEX idx_line_account_connection_checks_latest
  ON line_account_connection_checks(line_account_id, checked_at DESC);

CREATE INDEX idx_line_account_connection_checks_correlation
  ON line_account_connection_checks(correlation_id);
