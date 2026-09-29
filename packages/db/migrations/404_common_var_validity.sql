-- N-188: 共通情報の有効期間・代替値と、予約配信が固定した実行時snapshotを保存する。
-- ALTER TABLE ADD COLUMN と通常の表作成だけを使い、PRAGMAや複合SELECTに依存しない。
ALTER TABLE common_vars ADD COLUMN valid_from TEXT;
ALTER TABLE common_vars ADD COLUMN valid_until TEXT;
ALTER TABLE common_vars ADD COLUMN fallback_value TEXT;
ALTER TABLE common_vars ADD COLUMN expiry_behavior TEXT NOT NULL DEFAULT 'stop'
  CHECK (expiry_behavior IN ('stop', 'fallback'));

ALTER TABLE broadcasts ADD COLUMN common_var_snapshot TEXT
  CHECK (common_var_snapshot IS NULL OR json_valid(common_var_snapshot));
ALTER TABLE broadcasts ADD COLUMN common_var_snapshot_at TEXT;

CREATE TABLE common_var_resolution_failures (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('broadcast')),
  source_id       TEXT NOT NULL,
  var_key         TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('missing', 'not_started', 'expired', 'fallback_missing', 'invalid_window')),
  execution_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  UNIQUE(source_kind, source_id, var_key, execution_at)
);

CREATE INDEX idx_common_var_resolution_failures_source
  ON common_var_resolution_failures(source_kind, source_id, created_at DESC);
