-- N-192: 共通情報の監査付き非同期CSV出力の実行台帳。
-- 依頼者・対象account・出力条件・件数・開始/終了/失敗と期限付き成果物を残す。
-- 新表のみ。既存表の作り直しはしない。

CREATE TABLE IF NOT EXISTS common_var_export_jobs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  filter_json TEXT NOT NULL CHECK (json_valid(filter_json)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','expired')),
  total_count INTEGER CHECK (total_count IS NULL OR total_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  csv_text TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  expires_at TEXT NOT NULL,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_common_var_export_jobs_account
  ON common_var_export_jobs(line_account_id, created_at DESC);
