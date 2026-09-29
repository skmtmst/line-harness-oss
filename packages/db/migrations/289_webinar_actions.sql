-- V6 Webinar actions are immutable-by-version definitions. Executions are
-- append-only and use a stable idempotency key so retries do not duplicate work.

CREATE TABLE IF NOT EXISTS webinar_actions (
  id            TEXT PRIMARY KEY,
  webinar_id    TEXT NOT NULL REFERENCES webinars(id),
  trigger       TEXT NOT NULL CHECK (trigger IN ('completed', 'cta_clicked', 'unviewed')),
  action_type   TEXT NOT NULL CHECK (action_type IN ('add_tag', 'remove_tag', 'start_scenario', 'stop_scenario', 'resume_scenario', 'send_message', 'send_webhook', 'switch_rich_menu', 'remove_rich_menu')),
  config_json   TEXT NOT NULL DEFAULT '{}',
  position      INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (webinar_id, trigger, position, version)
);

CREATE INDEX IF NOT EXISTS idx_webinar_actions_webinar
  ON webinar_actions (webinar_id, trigger, position);

CREATE TABLE IF NOT EXISTS webinar_action_executions (
  id               TEXT PRIMARY KEY,
  webinar_action_id TEXT NOT NULL REFERENCES webinar_actions(id),
  webinar_id       TEXT NOT NULL REFERENCES webinars(id),
  friend_id        TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER,
  trigger          TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'succeeded', 'skipped', 'retry_wait', 'permanent_failed', 'cancelled')),
  attempt          INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT NOT NULL UNIQUE,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webinar_action_executions_status
  ON webinar_action_executions (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_webinar_action_executions_webinar
  ON webinar_action_executions (webinar_id, created_at);
