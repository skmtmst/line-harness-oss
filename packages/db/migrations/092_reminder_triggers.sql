-- リマインダのきっかけ。これまで対象の登録は
-- POST /api/reminders/:id/enroll/:friendId の手動だけで、
-- 「予約の前日に自動で送る」が表現できなかった。

-- manual / booking / event のいずれか。既定は従来どおり手動。
ALTER TABLE reminders ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual'
  CHECK (trigger_type IN ('manual', 'booking', 'event'));

-- 基準の何分前に送るか。trigger_type が manual 以外のときに使う。
ALTER TABLE reminders ADD COLUMN trigger_offset_minutes INTEGER;

-- 送る時刻を固定する場合の JST HH:MM。NULL なら offset だけで決める。
ALTER TABLE reminders ADD COLUMN send_at_time TEXT;

-- 対象を絞るタグ。NULL なら対象者全員。
ALTER TABLE reminders ADD COLUMN target_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL;
