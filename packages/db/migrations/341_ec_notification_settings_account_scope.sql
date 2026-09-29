-- EC通知の既定文面は全アカウント共通で残し、運用者が保存した値だけを
-- LINEアカウント単位で分離する。既存アカウントには現在値を複製して表示を保つ。
CREATE TABLE IF NOT EXISTS ec_notification_account_settings (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL REFERENCES ec_notification_settings(event_type) ON DELETE CASCADE,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  title_override TEXT,
  intro_text TEXT,
  outro_text TEXT,
  button_label TEXT,
  button_url TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (line_account_id, event_type)
);

INSERT OR IGNORE INTO ec_notification_account_settings
  (line_account_id, event_type, is_enabled, title_override, intro_text, outro_text,
   button_label, button_url, image_url, created_at, updated_at)
SELECT a.id, s.event_type, s.is_enabled, s.title_override, s.intro_text, s.outro_text,
       s.button_label, s.button_url, s.image_url, s.created_at, s.updated_at
  FROM line_accounts a
 CROSS JOIN ec_notification_settings s;
