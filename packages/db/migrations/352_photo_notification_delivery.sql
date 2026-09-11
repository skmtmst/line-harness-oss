-- migration-policy: table-rebuild
-- 写真審査の通知送達を復旧可能にする。LINE送信と送達記録のずれに備え、
-- 送信中（sending）状態とlease・世代カウンタを足す。既存行はそのまま引き継ぐ。

CREATE TABLE nen_photo_review_events_new (
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
    CHECK (notification_status IN ('pending', 'sending', 'sent', 'failed')),
  notification_error TEXT,
  notification_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (notification_attempt_count >= 0),
  notification_first_failed_at TEXT,
  notification_sent_at TEXT,
  notification_lease_id TEXT,
  notification_lease_expires_at TEXT,
  notification_generation INTEGER NOT NULL DEFAULT 0
    CHECK (notification_generation >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(photo_id, from_status)
);

INSERT INTO nen_photo_review_events_new (
  id, photo_id, line_account_id, from_status, to_status, reason_code, reason_note,
  awarded_points, reviewed_by, reviewed_by_name, notification_status,
  notification_error, notification_attempt_count, notification_first_failed_at,
  notification_sent_at, created_at, updated_at
)
SELECT
  id, photo_id, line_account_id, from_status, to_status, reason_code, reason_note,
  awarded_points, reviewed_by, reviewed_by_name, notification_status,
  notification_error, notification_attempt_count, notification_first_failed_at,
  notification_sent_at, created_at, updated_at
FROM nen_photo_review_events;

DROP TABLE nen_photo_review_events;

ALTER TABLE nen_photo_review_events_new RENAME TO nen_photo_review_events;

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、352 固有名で貼り直す。
-- sending はlease切れ後の再送拾い上げ用に含める。
CREATE INDEX idx_nen_photo_review_events_v352_account_created
  ON nen_photo_review_events(line_account_id, created_at DESC);
CREATE INDEX idx_nen_photo_review_events_v352_notification
  ON nen_photo_review_events(notification_status, created_at)
  WHERE notification_status IN ('pending', 'sending', 'failed');
