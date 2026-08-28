-- V6 7-1-H: リマインダを「送った／送れなかった／次に再試行する」まで辿れるようにする。
--
-- friend_reminder_deliveries は送信成功だけを残す既存の正本として維持する。
-- この表は外部送信の試行状態を持ち、既存履歴を置き換えない。

CREATE TABLE IF NOT EXISTS reminder_delivery_runs (
  id                         TEXT PRIMARY KEY,
  -- 古いリマインダにはアカウントが未設定の行がある。送信を止めずに履歴化し、
  -- 画面の到達可否は親 reminder の権限で判定するため、移行中だけNULLを許す。
  line_account_id            TEXT,
  reminder_id                TEXT NOT NULL,
  friend_reminder_id         TEXT NOT NULL,
  friend_id                  TEXT NOT NULL,
  reminder_step_id           TEXT NOT NULL,
  scheduled_at               TEXT NOT NULL,
  idempotency_key            TEXT NOT NULL UNIQUE,
  line_retry_key             TEXT NOT NULL UNIQUE,
  status                     TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN (
      'planned', 'claimed', 'succeeded', 'skipped',
      'retry_wait', 'permanent_failed', 'cancelled'
    )),
  attempt_count              INTEGER NOT NULL DEFAULT 0,
  retry_cycle_attempt_count  INTEGER NOT NULL DEFAULT 0,
  next_retry_at              TEXT,
  lease_expires_at           TEXT,
  last_error_code            TEXT,
  last_error_message         TEXT,
  line_request_id            TEXT,
  -- 実際に送った本文はmessages_logを正本にし、この実行から1本で辿れるようにする。
  message_log_id             TEXT,
  manual_retry_key           TEXT UNIQUE,
  started_at                 TEXT,
  completed_at               TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE (friend_reminder_id, reminder_step_id, scheduled_at)
);

CREATE INDEX IF NOT EXISTS idx_reminder_delivery_runs_due
  ON reminder_delivery_runs (status, next_retry_at, lease_expires_at, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_reminder_delivery_runs_reminder
  ON reminder_delivery_runs (line_account_id, reminder_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminder_delivery_runs_friend
  ON reminder_delivery_runs (friend_id, scheduled_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_delivery_runs_message_log
  ON reminder_delivery_runs (message_log_id)
  WHERE message_log_id IS NOT NULL;
