-- Migration 277: V6 ウェビナー通知。
--
-- 既存の webinar_registrations と開始5分前通知は残し、通知設定を保存した
-- ウェビナーだけを、申込直後・前日・1時間前・開始時・未視聴・視聴完了の
-- 明示的なジョブへ移す。古い申込は削除せず、再予約時は取消状態にする。

ALTER TABLE webinar_registrations
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'cancelled'));
ALTER TABLE webinar_registrations
  ADD COLUMN cancelled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_webinar_regs_active_friend
  ON webinar_registrations (webinar_id, friend_id, status, session_start_at);

CREATE TABLE IF NOT EXISTS webinar_notification_settings (
  webinar_id                  TEXT PRIMARY KEY REFERENCES webinars(id) ON DELETE CASCADE,
  version                     INTEGER NOT NULL DEFAULT 1,
  registration_enabled        INTEGER NOT NULL DEFAULT 1,
  day_before_enabled          INTEGER NOT NULL DEFAULT 1,
  day_before_time_minutes     INTEGER NOT NULL DEFAULT 1200,
  hour_before_enabled         INTEGER NOT NULL DEFAULT 1,
  hour_before_minutes         INTEGER NOT NULL DEFAULT 60,
  start_enabled               INTEGER NOT NULL DEFAULT 1,
  missed_enabled              INTEGER NOT NULL DEFAULT 1,
  missed_time_minutes         INTEGER NOT NULL DEFAULT 600,
  completed_enabled           INTEGER NOT NULL DEFAULT 1,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  CHECK (day_before_time_minutes BETWEEN 0 AND 1439),
  CHECK (hour_before_minutes BETWEEN 1 AND 10080),
  CHECK (missed_time_minutes BETWEEN 0 AND 1439)
);

CREATE TABLE IF NOT EXISTS webinar_notification_jobs (
  id                TEXT PRIMARY KEY,
  webinar_id        TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  registration_id   TEXT NOT NULL REFERENCES webinar_registrations(id) ON DELETE CASCADE,
  friend_id         TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at  INTEGER NOT NULL,
  settings_version  INTEGER NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
    'day_before', 'hour_before', 'session_start', 'missed', 'completed'
  )),
  scheduled_at      INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN (
                      'queued', 'claimed', 'succeeded', 'skipped',
                      'retry_wait', 'permanent_failed', 'cancelled'
                    )),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_retry_at     INTEGER,
  lease_expires_at  INTEGER,
  line_retry_key    TEXT NOT NULL,
  line_request_id   TEXT,
  sent_at           TEXT,
  cancelled_at      TEXT,
  last_error_code   TEXT,
  last_error_message TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (registration_id, settings_version, kind)
);

CREATE INDEX IF NOT EXISTS idx_webinar_notification_jobs_due
  ON webinar_notification_jobs (status, scheduled_at, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_webinar_notification_jobs_webinar
  ON webinar_notification_jobs (webinar_id, created_at);
