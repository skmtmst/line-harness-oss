-- v6-20 分析の非同期CSV書き出し（`POST /api/analytics/exports`）の実行台帳。
-- 依頼者・対象account・出力対象・出力条件・件数・開始/終了/失敗と期限付き成果物を残す。
-- 画面内のCSVと同じ中身をサーバ側で組み立て直す。書き出し対象ごとの列定義は
-- `packages/db/src/analytics-exports.ts` の builder が持ち、この表は運搬だけする。
-- 新表のみ。既存表の作り直しはしない。

CREATE TABLE IF NOT EXISTS analytics_export_jobs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  target TEXT NOT NULL
    CHECK (target IN ('reactions', 'url-clicks', 'cross', 'funnel', 'saved')),
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired')),
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

CREATE INDEX IF NOT EXISTS idx_analytics_export_jobs_account
  ON analytics_export_jobs(line_account_id, created_at DESC);
