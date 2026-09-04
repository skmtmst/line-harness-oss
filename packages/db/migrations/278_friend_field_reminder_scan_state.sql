-- 友だち情報欄を起点にするリマインダを、複数回の cron に分けて走査する。
-- カーソルはリマインダごとに保存し、途中で止まっても続きから再開できるようにする。
CREATE TABLE IF NOT EXISTS friend_field_reminder_scan_states (
  reminder_id TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE CASCADE,
  cursor      TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
