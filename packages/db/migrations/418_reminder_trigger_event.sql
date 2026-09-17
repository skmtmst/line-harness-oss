-- N-074 (#869): イベント起点リマインダを特定のイベントへ絞るための列。
-- NULL は「そのアカウントの全イベントが起点」という従来動作のまま。
ALTER TABLE reminders ADD COLUMN trigger_event_id TEXT;
CREATE INDEX IF NOT EXISTS idx_reminders_trigger_event ON reminders (trigger_event_id);
