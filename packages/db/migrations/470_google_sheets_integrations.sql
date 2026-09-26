-- #838 第2段: Google Sheets への直接書き出し（OAuth + Sheets API）。
-- 1 LINE公式アカウント = 1 連携 = 1 スプレッドシート。トークンは
-- packages/db/src/credential-crypto.ts の v1.… 形式だけを保存する。

-- アカウントごとのGoogle接続。refresh_token だけを持ち、access token は
-- 保存しない（同期ごとに refresh する）。切断は行ごと消す。
CREATE TABLE IF NOT EXISTS google_sheets_integrations (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL UNIQUE REFERENCES line_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT,
  google_account_email TEXT,
  refresh_token_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_target'
    CHECK (status IN ('pending_target', 'connected', 'expired')),
  spreadsheet_id TEXT,
  spreadsheet_title TEXT,
  -- データ種別ごとの再開点。{"friends": {"after": "...", "lastId": "..."}} の形。
  -- 途中で止まった同期が前回の続きから書き直すためのもの。
  sync_cursor_json TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  last_sync_status TEXT
    CHECK (last_sync_status IN ('ok', 'partial', 'error') OR last_sync_status IS NULL),
  last_sync_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  connected_by_staff_id TEXT,
  connected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 認可中の一時状態。1回使い切り・10分で失効（rt_google_oauth_states と同じ形）。
CREATE TABLE IF NOT EXISTS google_sheets_oauth_states (
  state TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('connect', 'reconnect')),
  code_verifier_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_google_sheets_oauth_states_expires
  ON google_sheets_oauth_states(expires_at);

-- 同期の記録。'running' の行が残っている間は新しい同期を始めない
-- （手動と定期の二重実行を防ぐ鍵代わり）。部分失敗時は cursor_json に
-- そこまでの再開点を残す。
CREATE TABLE IF NOT EXISTS google_sheets_sync_runs (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES google_sheets_integrations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'scheduled')),
  data_type TEXT NOT NULL CHECK (data_type IN ('friends', 'form_answers')),
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'error')),
  rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  cursor_json TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_google_sheets_sync_runs_integration
  ON google_sheets_sync_runs(integration_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_google_sheets_sync_runs_running
  ON google_sheets_sync_runs(integration_id, status)
  WHERE status = 'running';
