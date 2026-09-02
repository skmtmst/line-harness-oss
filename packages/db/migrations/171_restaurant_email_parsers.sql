-- 飲食店向け予約メールの媒体マスタ、解析結果、日次サマリー。
-- 既存予約列は変更せず、メール由来の情報を追加列として保持する。

CREATE TABLE IF NOT EXISTS rt_media (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('retty', 'gurunavi', 'tabelog', 'hotpepper')),
  name TEXT NOT NULL,
  sender_addresses TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sender_addresses)),
  parser_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

INSERT OR IGNORE INTO rt_media (id, code, name, sender_addresses, parser_key) VALUES
  ('media-retty', 'retty', 'Retty', '["reserve@retty.me","noreply@retty.me"]', 'retty'),
  ('media-gurunavi', 'gurunavi', 'ぐるなび', '["plan-reserve@gnavi.co.jp"]', 'gurunavi'),
  ('media-tabelog', 'tabelog', '食べログ', '["owner_support@tabelog.com"]', 'tabelog'),
  ('media-hotpepper', 'hotpepper', 'ホットペッパーグルメ', '["jp_kanri@hotpepper.jp"]', 'hotpepper');

ALTER TABLE rt_reservations ADD COLUMN media_id TEXT REFERENCES rt_media(id);
ALTER TABLE rt_reservations ADD COLUMN hold_expires_at TEXT;
ALTER TABLE rt_reservations ADD COLUMN cancel_reason TEXT;
ALTER TABLE rt_reservations ADD COLUMN stay_minutes INTEGER;
ALTER TABLE rt_reservations ADD COLUMN media_store_code TEXT;
ALTER TABLE rt_reservations ADD COLUMN table_label TEXT;
ALTER TABLE rt_reservations ADD COLUMN inbound_email_id TEXT REFERENCES rt_inbound_emails(id);
ALTER TABLE rt_reservations ADD COLUMN parser_key TEXT;
ALTER TABLE rt_reservations ADD COLUMN parser_version TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_reservations_external
  ON rt_reservations (store_id, source, external_id);

CREATE TABLE IF NOT EXISTS rt_email_digests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES rt_media(id),
  target_date TEXT NOT NULL,
  reported_count INTEGER NOT NULL CHECK (reported_count >= 0),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  inbound_email_id TEXT NOT NULL UNIQUE REFERENCES rt_inbound_emails(id)
);

CREATE INDEX IF NOT EXISTS idx_rt_email_digests_store_date
  ON rt_email_digests (store_id, target_date, media_id);
