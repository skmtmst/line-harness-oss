-- ファイル検査の設定。外の検査サービスを使う口だけ持つ。
-- 鍵そのものはここに置かず、秘密値の仕組みにある名前(secret_ref)だけを指す。
CREATE TABLE IF NOT EXISTS file_scan_configs (
  line_account_id      TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  external_provider    TEXT,
  external_endpoint_url TEXT,
  external_secret_ref  TEXT,
  external_timeout_ms  INTEGER NOT NULL DEFAULT 10000 CHECK (external_timeout_ms > 0),
  max_bytes_override   INTEGER CHECK (max_bytes_override IS NULL OR max_bytes_override > 0),
  max_pixels_override  INTEGER CHECK (max_pixels_override IS NULL OR max_pixels_override > 0),
  stopped_notified_at  TEXT,
  updated_by           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
