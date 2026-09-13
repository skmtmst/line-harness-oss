-- 計測先サイトのホストを、参照元URLとは分けて保存する。
ALTER TABLE site_events ADD COLUMN host TEXT;

CREATE INDEX IF NOT EXISTS idx_site_events_account_host_path
  ON site_events(line_account_id, host, path, occurred_at);
