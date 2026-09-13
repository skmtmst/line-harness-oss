-- 機能14: 共通情報の社内メモ、楽観ロック、変更履歴、安全な差し替え履歴。

ALTER TABLE common_vars ADD COLUMN memo TEXT NOT NULL DEFAULT '';
ALTER TABLE common_vars ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE common_vars ADD COLUMN updated_by TEXT;
ALTER TABLE common_vars ADD COLUMN archived_at TEXT;
ALTER TABLE common_vars ADD COLUMN replacement_run_id TEXT;

CREATE TABLE common_var_versions (
  id             TEXT PRIMARY KEY,
  common_var_id  TEXT NOT NULL REFERENCES common_vars(id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL,
  name           TEXT NOT NULL,
  value          TEXT NOT NULL,
  memo           TEXT NOT NULL DEFAULT '',
  change_reason  TEXT NOT NULL,
  actor_id       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  UNIQUE(common_var_id, version_no)
);

CREATE TABLE common_var_replacement_runs (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_common_var_id  TEXT NOT NULL REFERENCES common_vars(id),
  replacement_common_var_id TEXT NOT NULL REFERENCES common_vars(id),
  source_version        INTEGER NOT NULL,
  expected_usage_count  INTEGER NOT NULL,
  replaced_usage_count  INTEGER NOT NULL,
  actor_id              TEXT,
  status                TEXT NOT NULL CHECK (status IN ('completed', 'partial')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

INSERT INTO common_var_versions
  (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
SELECT 'imported-' || id, id, 1, name, value, '', '既存データを初版として登録', NULL, created_at
  FROM common_vars;

CREATE INDEX idx_common_var_versions_history
  ON common_var_versions(common_var_id, version_no DESC);

CREATE INDEX idx_common_var_replacement_runs_source
  ON common_var_replacement_runs(source_common_var_id, created_at DESC);

CREATE INDEX idx_common_vars_account_active
  ON common_vars(line_account_id, archived_at, name, id);
