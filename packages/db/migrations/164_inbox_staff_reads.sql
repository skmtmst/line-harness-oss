-- 受信箱の既読は担当者ごとに分ける。
-- Aさんが開いても、Bさんの未読を消さないための読み取り位置。
CREATE TABLE IF NOT EXISTS inbox_staff_reads (
  staff_id       TEXT NOT NULL,
  channel        TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id TEXT NOT NULL,
  last_read_at   TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (staff_id, channel, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_staff_reads_conversation
  ON inbox_staff_reads (channel, conversation_id, staff_id);

-- 管理画面では、公式LINEアカウントではなく「実際に返信した担当者」も表示する。
-- LINE側へ見える送信者は従来どおり公式アカウントのまま。
ALTER TABLE messages_log ADD COLUMN sent_by_staff_id TEXT;
