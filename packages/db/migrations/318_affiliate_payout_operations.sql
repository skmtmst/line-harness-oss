-- 機能16: 振込先、支払バッチ、明細書を締めスナップショットへ接続する。
-- 口座番号は暗号文だけを保存し、通常API用には末尾4桁だけを持つ。

CREATE TABLE IF NOT EXISTS affiliate_bank_profiles (
  affiliate_id TEXT PRIMARY KEY REFERENCES affiliates(id),
  organization_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ordinary', 'checking')),
  account_number_encrypted TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  account_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_idempotency_key TEXT NOT NULL,
  last_request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, line_account_id, last_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_bank_profiles_scope
  ON affiliate_bank_profiles(organization_id, line_account_id, affiliate_id);

ALTER TABLE affiliate_settlements ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT '';

ALTER TABLE affiliate_payout_batches ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE affiliate_payout_batches ADD COLUMN idempotency_key TEXT;
ALTER TABLE affiliate_payout_batches ADD COLUMN request_fingerprint TEXT;
ALTER TABLE affiliate_payout_batches ADD COLUMN export_object_key TEXT;
ALTER TABLE affiliate_payout_batches ADD COLUMN export_expires_at TEXT;
ALTER TABLE affiliate_payout_batches ADD COLUMN download_token_hash TEXT;
ALTER TABLE affiliate_payout_batches ADD COLUMN export_idempotency_key TEXT;
ALTER TABLE affiliate_payout_batches ADD COLUMN export_request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_payout_batches_idempotency
  ON affiliate_payout_batches(organization_id, line_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS affiliate_payout_batch_lines (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES affiliate_payout_batches(id),
  settlement_line_id TEXT NOT NULL REFERENCES affiliate_settlement_lines(id),
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  amount_minor INTEGER NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ordinary', 'checking')),
  account_number_encrypted TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (batch_id, settlement_line_id)
);

ALTER TABLE affiliate_statements ADD COLUMN idempotency_key TEXT;
ALTER TABLE affiliate_statements ADD COLUMN request_fingerprint TEXT;
ALTER TABLE affiliate_statements ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE affiliate_statements ADD COLUMN file_checksum TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_statements_idempotency
  ON affiliate_statements(organization_id, line_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
