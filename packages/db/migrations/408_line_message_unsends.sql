-- LINEの送信取消を、同じ公式アカウント内のmessage IDにだけ反映する。
-- 取消がmessageより先に届いても、後着本文を復活させないため墓標を別表へ残す。

ALTER TABLE messages_log ADD COLUMN line_message_id TEXT;
ALTER TABLE messages_log ADD COLUMN line_message_account_key TEXT;
ALTER TABLE messages_log ADD COLUMN unsent_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_log_line_message_scope
  ON messages_log (line_message_account_key, line_message_id)
  WHERE line_message_id IS NOT NULL AND line_message_account_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS line_message_unsends (
  line_message_account_key TEXT NOT NULL,
  line_message_id          TEXT NOT NULL,
  source_user_id           TEXT,
  unsent_at                TEXT NOT NULL,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (line_message_account_key, line_message_id)
);
