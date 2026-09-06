-- V6 機能3: UID移行と友だちCSVの実行台帳。
-- dry-run と本実行を分け、元の友だちを上書きせず、切り戻し情報を残す。

CREATE TABLE IF NOT EXISTS uid_migration_runs (
  id TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  to_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('csv','verified_api','manual')),
  source_filename TEXT,
  source_checksum TEXT,
  status TEXT NOT NULL DEFAULT 'dry_run'
    CHECK (status IN ('dry_run','review','ready','executing','completed','failed','rolled_back')),
  dry_run_revision INTEGER NOT NULL DEFAULT 1 CHECK (dry_run_revision >= 1),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  auto_count INTEGER NOT NULL DEFAULT 0 CHECK (auto_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  unmatched_count INTEGER NOT NULL DEFAULT 0 CHECK (unmatched_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  applied_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  executed_at TEXT,
  completed_at TEXT,
  rolled_back_at TEXT,
  failure_reason TEXT,
  CHECK (from_account_id <> to_account_id),
  CHECK (total_count = auto_count + review_count + unmatched_count + conflict_count)
);

CREATE INDEX IF NOT EXISTS idx_uid_migration_runs_accounts
  ON uid_migration_runs(from_account_id, to_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uid_migration_runs_status
  ON uid_migration_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS uid_migration_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES uid_migration_runs(id) ON DELETE RESTRICT,
  old_uid TEXT NOT NULL,
  new_uid TEXT,
  old_friend_id TEXT REFERENCES friends(id) ON DELETE RESTRICT,
  new_friend_id TEXT REFERENCES friends(id) ON DELETE RESTRICT,
  candidate_name TEXT,
  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN ('same_provider','line_login','signed_customer_id','verified_contact','operator_csv','manual')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  classification TEXT NOT NULL
    CHECK (classification IN ('auto','review','unmatched','conflict')),
  conflict_reason TEXT,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','link','create','exclude')),
  decided_by TEXT,
  decided_at TEXT,
  result TEXT NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending','applied','skipped','failed','rolled_back')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, old_uid)
);

CREATE INDEX IF NOT EXISTS idx_uid_migration_items_run
  ON uid_migration_items(run_id, classification, decision);

CREATE TABLE IF NOT EXISTS friend_export_jobs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  filter_json TEXT NOT NULL CHECK (json_valid(filter_json)),
  columns_json TEXT NOT NULL CHECK (json_valid(columns_json)),
  encoding TEXT NOT NULL CHECK (encoding IN ('utf-8','shift_jis')),
  status TEXT NOT NULL CHECK (status IN ('completed','failed','expired')),
  row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_friend_export_jobs_account
  ON friend_export_jobs(line_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friend_import_jobs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  source_filename TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  rows_json TEXT NOT NULL CHECK (json_valid(rows_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  status TEXT NOT NULL CHECK (status IN ('previewed','completed','failed')),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  add_count INTEGER NOT NULL DEFAULT 0 CHECK (add_count >= 0),
  update_count INTEGER NOT NULL DEFAULT 0 CHECK (update_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  executed_at TEXT,
  failure_reason TEXT,
  UNIQUE(line_account_id, source_checksum)
);

CREATE INDEX IF NOT EXISTS idx_friend_import_jobs_account
  ON friend_import_jobs(line_account_id, created_at DESC);
