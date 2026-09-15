-- N-450: 健全性チェックの異常を、アカウント・確認項目ごとに1件だけ追跡する。
-- 同じ状態を5分ごとに通知しない。悪化・解消・再発だけをeventとして残す。
CREATE TABLE operation_alerts (
  id                   TEXT PRIMARY KEY,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  check_key            TEXT NOT NULL CHECK (check_key IN (
    'line_connection', 'message_quota', 'external_integrations',
    'webhook', 'dispatch_jobs', 'friend_change'
  )),
  status               TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
  severity             TEXT NOT NULL CHECK (severity IN ('unknown', 'warning', 'danger')),
  summary              TEXT NOT NULL,
  source_run_id        TEXT NOT NULL REFERENCES operation_health_runs(id) ON DELETE CASCADE,
  first_detected_at    TEXT NOT NULL,
  last_detected_at     TEXT NOT NULL,
  acknowledged_at      TEXT,
  acknowledged_by_id   TEXT,
  acknowledgement_note TEXT,
  resolved_at          TEXT,
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  reopened_count       INTEGER NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (line_account_id, check_key)
);

CREATE INDEX idx_operation_alerts_account_status
  ON operation_alerts(line_account_id, status, updated_at DESC);

CREATE TABLE operation_alert_events (
  id                    TEXT PRIMARY KEY,
  alert_id              TEXT NOT NULL REFERENCES operation_alerts(id) ON DELETE CASCADE,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_run_id         TEXT REFERENCES operation_health_runs(id) ON DELETE SET NULL,
  action                TEXT NOT NULL CHECK (action IN ('opened', 'escalated', 'acknowledged', 'resolved', 'reopened')),
  severity              TEXT NOT NULL CHECK (severity IN ('unknown', 'warning', 'danger')),
  summary               TEXT NOT NULL,
  actor_id              TEXT,
  note                  TEXT,
  alert_version         INTEGER NOT NULL CHECK (alert_version > 0),
  notification_enqueued_at TEXT,
  notification_recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (notification_recipient_count >= 0),
  notification_missing_contact_count INTEGER NOT NULL DEFAULT 0 CHECK (notification_missing_contact_count >= 0),
  created_at            TEXT NOT NULL,
  UNIQUE (alert_id, alert_version)
);

CREATE INDEX idx_operation_alert_events_alert_created
  ON operation_alert_events(alert_id, created_at DESC);

CREATE TABLE operation_alert_notification_outbox (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL REFERENCES operation_alert_events(id) ON DELETE CASCADE,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  staff_id           TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  channel            TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempt_count      INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at    TEXT NOT NULL,
  last_error         TEXT,
  sent_at            TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (event_id, staff_id, channel)
);

CREATE INDEX idx_operation_alert_notification_due
  ON operation_alert_notification_outbox(status, next_attempt_at);
