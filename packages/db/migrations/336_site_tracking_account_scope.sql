-- サイト計測をLINE公式アカウントごとに分ける。
-- 計測コードの鍵をアカウント別に発行し、訪問と操作に所有先を残す。
-- 既存の記録は帰属不明のため NULL のまま残す(消さない)。

CREATE TABLE IF NOT EXISTS site_tracking_keys (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL UNIQUE REFERENCES line_accounts(id) ON DELETE CASCADE,
  tracking_key    TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

ALTER TABLE site_visitors ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
ALTER TABLE site_events ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_site_visitors_account ON site_visitors(line_account_id);
CREATE INDEX IF NOT EXISTS idx_site_events_account_occurred ON site_events(line_account_id, occurred_at);
