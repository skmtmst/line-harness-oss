-- V6 機能24: LINE通知の公開版と共通送信台帳。
--
-- 既存 notification_rules / notifications は管理画面内通知の互換経路として残す。
-- 過去行をこの台帳へ移さないことで、移行をきっかけに再送される事故を防ぐ。

CREATE TABLE IF NOT EXISTS customer_notification_definitions (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  key                   TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  source_event_type     TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'stopped')),
  current_version_id    TEXT,
  draft_config_json     TEXT NOT NULL DEFAULT '{}',
  transactional_only    INTEGER NOT NULL DEFAULT 1
                        CHECK (transactional_only = 1),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by            TEXT NOT NULL,
  updated_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (line_account_id, key)
);

CREATE TABLE IF NOT EXISTS customer_notification_versions (
  id                      TEXT PRIMARY KEY,
  definition_id           TEXT NOT NULL REFERENCES customer_notification_definitions(id) ON DELETE CASCADE,
  version_number          INTEGER NOT NULL CHECK (version_number > 0),
  config_json             TEXT NOT NULL,
  line_template_json      TEXT NOT NULL,
  aggregation_rule        TEXT NOT NULL DEFAULT 'definition_day',
  email_fallback_policy   TEXT NOT NULL DEFAULT 'disabled',
  published_by            TEXT NOT NULL,
  published_at            TEXT NOT NULL,
  UNIQUE (definition_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_notification_definitions_account
  ON customer_notification_definitions(line_account_id, status, category, name, id);

CREATE TABLE IF NOT EXISTS notification_instances (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  audience_type           TEXT NOT NULL CHECK (audience_type IN ('customer', 'operator')),
  definition_id           TEXT,
  definition_version_id   TEXT,
  source_event_type       TEXT NOT NULL,
  source_event_id         TEXT NOT NULL,
  source_metadata_json    TEXT,
  dedupe_key              TEXT NOT NULL,
  occurrence_count        INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  grouped_count           INTEGER NOT NULL DEFAULT 1 CHECK (grouped_count > 0),
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed', 'excluded', 'failed')),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (line_account_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  instance_id             TEXT NOT NULL REFERENCES notification_instances(id) ON DELETE CASCADE,
  audience_type           TEXT NOT NULL CHECK (audience_type IN ('customer', 'operator')),
  recipient_type          TEXT NOT NULL CHECK (recipient_type IN ('friend', 'staff', 'team', 'role')),
  recipient_id            TEXT NOT NULL,
  channel                 TEXT NOT NULL CHECK (channel IN ('line', 'email', 'in_app')),
  idempotency_key         TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'provider_accepted', 'excluded', 'retry_wait', 'failed')),
  retryable               INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  attempts                INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at           TEXT,
  provider_request_id     TEXT,
  provider_status         TEXT,
  error_code              TEXT,
  error_message_safe      TEXT,
  queued_at               TEXT NOT NULL,
  accepted_at             TEXT,
  failed_at               TEXT,
  execution_mode          TEXT NOT NULL DEFAULT 'automatic'
                          CHECK (execution_mode IN ('automatic', 'retry', 'resend', 'test')),
  version                 INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at              TEXT NOT NULL,
  UNIQUE (line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_account_status
  ON notification_deliveries(line_account_id, status, queued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_retry
  ON notification_deliveries(status, retryable, next_retry_at);

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  id                    TEXT PRIMARY KEY,
  delivery_id           TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  attempt_number        INTEGER NOT NULL CHECK (attempt_number > 0),
  retry_key             TEXT NOT NULL,
  outcome               TEXT NOT NULL CHECK (outcome IN ('provider_accepted', 'retry_wait', 'failed')),
  provider_request_id   TEXT,
  error_code            TEXT,
  error_message_safe    TEXT,
  attempted_at          TEXT NOT NULL,
  UNIQUE (delivery_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS notification_interactions (
  id            TEXT PRIMARY KEY,
  delivery_id   TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  link_key      TEXT NOT NULL,
  clicked_at    TEXT NOT NULL,
  UNIQUE (delivery_id, link_key, clicked_at)
);

CREATE INDEX IF NOT EXISTS idx_notification_interactions_delivery
  ON notification_interactions(delivery_id, clicked_at DESC);

CREATE TABLE IF NOT EXISTS notification_aggregate_metrics (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  definition_id         TEXT NOT NULL REFERENCES customer_notification_definitions(id) ON DELETE CASCADE,
  metric_date           TEXT NOT NULL,
  aggregation_unit      TEXT NOT NULL,
  accepted_count        INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  display_count         INTEGER CHECK (display_count IS NULL OR display_count >= 0),
  click_count           INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  state                 TEXT NOT NULL CHECK (state IN ('waiting', 'ready', 'unavailable_privacy', 'failed')),
  reason                TEXT,
  updated_at            TEXT NOT NULL,
  UNIQUE (line_account_id, definition_id, metric_date, aggregation_unit)
);

CREATE INDEX IF NOT EXISTS idx_notification_metrics_account_date
  ON notification_aggregate_metrics(line_account_id, metric_date DESC, definition_id);
