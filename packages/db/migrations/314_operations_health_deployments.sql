-- 機能32: サーバー実行の健全性チェック、重要操作の再認証、配備履歴、通知outbox。
CREATE TABLE IF NOT EXISTS operation_health_runs (
  id                TEXT PRIMARY KEY,
  scope_key         TEXT NOT NULL,
  line_account_id   TEXT REFERENCES line_accounts(id),
  window_started_at TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('scheduled', 'manual')),
  status            TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  overall_status    TEXT NOT NULL CHECK (overall_status IN ('normal', 'warning', 'danger', 'unknown')),
  actor_id          TEXT,
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  error_message     TEXT,
  UNIQUE (scope_key, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_operation_health_runs_scope_started
  ON operation_health_runs(scope_key, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS operation_health_results (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES operation_health_runs(id) ON DELETE CASCADE,
  check_key      TEXT NOT NULL CHECK (check_key IN (
    'line_connection', 'message_quota', 'external_integrations',
    'webhook', 'dispatch_jobs', 'friend_change'
  )),
  status         TEXT NOT NULL CHECK (status IN ('normal', 'warning', 'danger', 'unknown')),
  summary        TEXT NOT NULL,
  value_json     TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  threshold_json TEXT CHECK (threshold_json IS NULL OR json_valid(threshold_json)),
  source         TEXT NOT NULL,
  observed_at    TEXT NOT NULL,
  UNIQUE (run_id, check_key)
);

CREATE INDEX IF NOT EXISTS idx_operation_health_results_run
  ON operation_health_results(run_id, check_key);

CREATE TABLE IF NOT EXISTS auth_step_up_grants (
  token_hash  TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_step_up_grants_staff_expiry
  ON auth_step_up_grants(staff_id, expires_at);

CREATE TABLE IF NOT EXISTS operation_request_receipts (
  action          TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (action, actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operation_deployment_events (
  id                 TEXT PRIMARY KEY,
  deployment_id      TEXT NOT NULL,
  phase              TEXT NOT NULL CHECK (phase IN (
    'queued', 'deploying', 'verifying', 'succeeded', 'failed', 'rolled_back'
  )),
  environment        TEXT NOT NULL,
  from_commit        TEXT,
  to_commit          TEXT,
  version            TEXT,
  migration_json     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(migration_json)),
  rollback_available INTEGER NOT NULL DEFAULT 0 CHECK (rollback_available IN (0, 1)),
  downtime_seconds   INTEGER CHECK (downtime_seconds IS NULL OR downtime_seconds >= 0),
  pull_request       INTEGER,
  release_summary    TEXT,
  actor              TEXT NOT NULL,
  smoke_check_json   TEXT CHECK (smoke_check_json IS NULL OR json_valid(smoke_check_json)),
  occurred_at        TEXT NOT NULL,
  received_at        TEXT NOT NULL,
  UNIQUE (deployment_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_operation_deployment_events_occurred
  ON operation_deployment_events(occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS operation_notification_outbox (
  id              TEXT PRIMARY KEY,
  incident_id     TEXT NOT NULL REFERENCES operation_incidents(id),
  event_kind      TEXT NOT NULL CHECK (event_kind IN ('stopped', 'restored')),
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error      TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (incident_id, event_kind, channel)
);

CREATE INDEX IF NOT EXISTS idx_operation_notification_outbox_due
  ON operation_notification_outbox(status, next_attempt_at);
