-- 友だち情報欄をV6の型・版・移行契約へ拡張する。
-- 既存の value は互換読取用に残し、型付き列へ段階的に切り替える。

ALTER TABLE friend_fields ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'read_only', 'archived'));
ALTER TABLE friend_fields ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- 既存 type のCHECKを壊さず、V6の3種類を段階的に読める列へ保存する。
ALTER TABLE friend_fields ADD COLUMN type_v6 TEXT
  CHECK (type_v6 IS NULL OR type_v6 IN (
    'text','textarea','number','date','datetime','tel','email','url',
    'select','multi_select','checkbox','image','pdf'
  ));
UPDATE friend_fields SET type_v6 = type WHERE type_v6 IS NULL;

ALTER TABLE friend_field_values ADD COLUMN value_text TEXT;
ALTER TABLE friend_field_values ADD COLUMN value_number REAL;
ALTER TABLE friend_field_values ADD COLUMN value_date TEXT;
ALTER TABLE friend_field_values ADD COLUMN value_datetime TEXT;
ALTER TABLE friend_field_values ADD COLUMN value_json TEXT
  CHECK (value_json IS NULL OR json_valid(value_json));
ALTER TABLE friend_field_values ADD COLUMN media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE friend_field_values ADD COLUMN source_type TEXT;
ALTER TABLE friend_field_values ADD COLUMN source_id TEXT;
ALTER TABLE friend_field_values ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS field_migration_runs (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id),
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id),
  source_field_id       TEXT NOT NULL REFERENCES friend_fields(id),
  target_field_id       TEXT NOT NULL REFERENCES friend_fields(id),
  source_version        INTEGER NOT NULL,
  target_version        INTEGER NOT NULL,
  preview_token_hash    TEXT NOT NULL UNIQUE,
  preview_snapshot_hash TEXT NOT NULL,
  preview_expires_at    TEXT NOT NULL,
  idempotency_key       TEXT,
  status                TEXT NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'queued', 'running', 'partial', 'succeeded', 'failed', 'stale')),
  usage_targets_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(usage_targets_json)),
  total_count           INTEGER NOT NULL DEFAULT 0,
  convertible_count     INTEGER NOT NULL DEFAULT 0,
  review_count          INTEGER NOT NULL DEFAULT 0,
  invalid_count         INTEGER NOT NULL DEFAULT 0,
  processed_count       INTEGER NOT NULL DEFAULT 0,
  succeeded_count       INTEGER NOT NULL DEFAULT 0,
  failed_count          INTEGER NOT NULL DEFAULT 0,
  error_message         TEXT,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  started_at            TEXT,
  completed_at          TEXT,
  rollback_deadline     TEXT,
  updated_at            TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_migration_runs_idempotency
  ON field_migration_runs(tenant_id, line_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_migration_runs_scope
  ON field_migration_runs(tenant_id, line_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS field_migration_items (
  run_id          TEXT NOT NULL REFERENCES field_migration_runs(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  source_value    TEXT NOT NULL,
  converted_value TEXT,
  status          TEXT NOT NULL CHECK (status IN ('convertible', 'review', 'invalid', 'succeeded', 'failed')),
  reason          TEXT,
  migrated_at     TEXT,
  PRIMARY KEY (run_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_field_migration_items_status
  ON field_migration_items(run_id, status, friend_id);
