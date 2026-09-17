-- N-025: 引用返信と送信予約
--
-- 引用返信: LINEの受信メッセージが持つ quoteToken を保存し、返信時に引用元を
-- messages_log 上の行で結びつける。表示は引用元の行を join して作るので、
-- 引用元が取り消されても表示側は is_unsent 側の扱いに追随する。
ALTER TABLE messages_log ADD COLUMN quote_token TEXT;
ALTER TABLE messages_log ADD COLUMN quoted_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_log_quoted
  ON messages_log (quoted_message_id);

-- 送信予約: scheduled -> sending(lease付) -> sent/failed/cancelled。
-- idempotency_key は一意で、予約作成の二重登録と送信の二重pushを両方止める。
CREATE TABLE IF NOT EXISTS scheduled_chat_sends (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL,
  line_account_id TEXT,
  staff_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  quoted_message_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  lease_token TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error TEXT,
  sent_message_id TEXT,
  sent_at TEXT,
  failed_at TEXT,
  cancelled_by_staff_id TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- cron が「scheduled で期限到来」を拾う用。
CREATE INDEX IF NOT EXISTS idx_scheduled_chat_sends_due
  ON scheduled_chat_sends (status, scheduled_at);
-- 会話ごとの予約一覧用。
CREATE INDEX IF NOT EXISTS idx_scheduled_chat_sends_friend
  ON scheduled_chat_sends (friend_id, status, scheduled_at);
-- sending滞留の回収用。
CREATE INDEX IF NOT EXISTS idx_scheduled_chat_sends_lease
  ON scheduled_chat_sends (status, lease_expires_at);
