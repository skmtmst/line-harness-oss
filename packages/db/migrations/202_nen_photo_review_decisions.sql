-- 写真審査の理由・担当者・通知結果を残し、同じ未審査写真への二重判断を防ぐ。
ALTER TABLE nen_photo_submissions ADD COLUMN review_reason_code TEXT
  CHECK (review_reason_code IS NULL OR review_reason_code IN ('quality', 'privacy', 'unrelated', 'duplicate', 'other'));
ALTER TABLE nen_photo_submissions ADD COLUMN review_reason_note TEXT;
-- 環境変数で認証する所有者は staff 表に行を持たないため、監査主体IDは外部キーにしない。
ALTER TABLE nen_photo_submissions ADD COLUMN reviewed_by TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN reviewed_by_name TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN review_notification_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (review_notification_status IN ('not_required', 'pending', 'sent', 'failed'));

CREATE TABLE nen_photo_review_events (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  from_status TEXT NOT NULL CHECK (from_status = 'pending'),
  to_status TEXT NOT NULL CHECK (to_status IN ('adopted', 'rejected')),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('quality', 'privacy', 'unrelated', 'duplicate', 'other')),
  reason_note TEXT,
  awarded_points INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT NOT NULL,
  reviewed_by_name TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed')),
  notification_error TEXT,
  notification_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (notification_attempt_count >= 0),
  notification_first_failed_at TEXT,
  notification_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(photo_id, from_status)
);

CREATE INDEX idx_nen_photo_review_events_account_created
  ON nen_photo_review_events(line_account_id, created_at DESC);
CREATE INDEX idx_nen_photo_review_events_notification
  ON nen_photo_review_events(notification_status, created_at)
  WHERE notification_status IN ('pending', 'failed');
