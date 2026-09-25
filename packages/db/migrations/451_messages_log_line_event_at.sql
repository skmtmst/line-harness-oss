-- 受信の並びを LINE のイベント時刻順にする (P1-02)。
--
-- 届く順と起こった順は逆転する (再送・遅延)。保存時刻 (created_at) だけで
-- 並べると、後から届いた古いメッセージが一番上に来る。LINE イベントの
-- timestamp を line_event_at に残し、一覧とスレッドの並びはそちらを正とする。
-- 送信分・既存分は NULL のまま COALESCE(created_at) で従来どおり扱う。

ALTER TABLE messages_log ADD COLUMN line_event_at TEXT;

UPDATE messages_log SET line_event_at = created_at WHERE line_event_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_log_line_event_at
  ON messages_log (line_event_at);
