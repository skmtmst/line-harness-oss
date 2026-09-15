-- migration-policy: table-rebuild
-- 共通情報に長文・日付・日時・真偽を追加する。PRAGMAを使わないD1互換の再構築。
CREATE TABLE common_vars_next (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  var_key TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','url','image','number','long_text','date','datetime','boolean')),
  value TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  memo TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT, archived_at TEXT, replacement_run_id TEXT,
  UNIQUE(line_account_id, var_key)
);
INSERT INTO common_vars_next SELECT id, folder_id, name, var_key, type, value, created_at, updated_at, line_account_id, memo, version, updated_by, archived_at, replacement_run_id FROM common_vars;
CREATE TABLE common_var_schedules_next (id TEXT PRIMARY KEY, var_id TEXT NOT NULL REFERENCES common_vars_next(id) ON DELETE CASCADE, effective_from TEXT NOT NULL, value TEXT NOT NULL, applied_at TEXT);
INSERT INTO common_var_schedules_next SELECT id, var_id, effective_from, value, applied_at FROM common_var_schedules;
CREATE TABLE common_var_versions_next (id TEXT PRIMARY KEY, common_var_id TEXT NOT NULL REFERENCES common_vars_next(id) ON DELETE CASCADE, version_no INTEGER NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', change_reason TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')), UNIQUE(common_var_id, version_no));
INSERT INTO common_var_versions_next SELECT id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at FROM common_var_versions;
CREATE TABLE common_var_replacement_runs_next (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE, source_common_var_id TEXT NOT NULL REFERENCES common_vars_next(id), replacement_common_var_id TEXT NOT NULL REFERENCES common_vars_next(id), source_version INTEGER NOT NULL, expected_usage_count INTEGER NOT NULL, replaced_usage_count INTEGER NOT NULL, actor_id TEXT, status TEXT NOT NULL CHECK (status IN ('completed', 'partial')), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')));
INSERT INTO common_var_replacement_runs_next SELECT id, line_account_id, source_common_var_id, replacement_common_var_id, source_version, expected_usage_count, replaced_usage_count, actor_id, status, created_at FROM common_var_replacement_runs;
DROP TABLE common_var_schedules;
DROP TABLE common_var_versions;
DROP TABLE common_var_replacement_runs;
DROP TABLE common_vars;
ALTER TABLE common_vars_next RENAME TO common_vars;
ALTER TABLE common_var_schedules_next RENAME TO common_var_schedules;
ALTER TABLE common_var_versions_next RENAME TO common_var_versions;
ALTER TABLE common_var_replacement_runs_next RENAME TO common_var_replacement_runs;
CREATE INDEX idx_common_vars_v400_account_active ON common_vars(line_account_id, archived_at, name, id);
CREATE INDEX idx_common_var_schedules_v400_pending ON common_var_schedules(var_id, effective_from) WHERE applied_at IS NULL;
CREATE INDEX idx_common_var_versions_v400_history ON common_var_versions(common_var_id, version_no DESC);
CREATE INDEX idx_common_var_replacement_runs_v400_source ON common_var_replacement_runs(source_common_var_id, created_at DESC);
