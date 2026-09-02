-- ダッシュボードの通知センター用の所属と既読状態。
--
-- status は配信処理の状態（pending / sent / failed）なので、既読には流用しない。
-- 既読は運用者ごとに違うため、別表で持つ。
ALTER TABLE notification_rules
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);

ALTER TABLE notifications
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);

ALTER TABLE notifications
  ADD COLUMN category TEXT NOT NULL DEFAULT 'info'
    CHECK (category IN ('error', 'update', 'info'));

CREATE INDEX IF NOT EXISTS idx_notification_rules_account
  ON notification_rules(line_account_id, event_type, is_active);

CREATE INDEX IF NOT EXISTS idx_notifications_center
  ON notifications(line_account_id, category, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_notification_reads (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  staff_id        TEXT NOT NULL,
  read_at         TEXT NOT NULL,
  PRIMARY KEY (notification_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_notification_reads_staff
  ON staff_notification_reads(staff_id, read_at DESC);
