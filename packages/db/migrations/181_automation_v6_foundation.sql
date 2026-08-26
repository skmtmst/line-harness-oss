-- V6 オートメーション基盤。
--
-- 旧 automations / automation_logs は移行元・過去履歴として残す。
-- このマイグレーションは新形式の受け皿を追加するだけで、既存行を変更しない。

CREATE TABLE IF NOT EXISTS automation_definitions (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL REFERENCES line_accounts(id),
  name                         TEXT NOT NULL,
  description                  TEXT,
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'active', 'stopped', 'archived')),
  priority                     INTEGER NOT NULL DEFAULT 0,
  current_draft_version_id     TEXT REFERENCES automation_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES automation_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  legacy_automation_id         TEXT UNIQUE,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_definitions_account_status
  ON automation_definitions(line_account_id, status, priority DESC);

CREATE TABLE IF NOT EXISTS automation_versions (
  id                TEXT PRIMARY KEY,
  automation_id     TEXT NOT NULL REFERENCES automation_definitions(id),
  version_number    INTEGER NOT NULL CHECK (version_number > 0),
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published')),
  trigger_type      TEXT NOT NULL,
  trigger_config    TEXT NOT NULL DEFAULT '{}',
  condition_config  TEXT NOT NULL DEFAULT '{}',
  action_config     TEXT NOT NULL DEFAULT '[]',
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  published_at      TEXT,
  UNIQUE (automation_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_automation_versions_automation_status
  ON automation_versions(automation_id, status, version_number DESC);

CREATE TRIGGER IF NOT EXISTS trg_automation_published_version_immutable
BEFORE UPDATE ON automation_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published automation version is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_automation_published_version_no_delete
BEFORE DELETE ON automation_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published automation version cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS common_actions (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL REFERENCES line_accounts(id),
  name                         TEXT NOT NULL,
  description                  TEXT,
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'archived')),
  current_draft_version_id     TEXT REFERENCES common_action_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES common_action_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_common_actions_account_status
  ON common_actions(line_account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS common_action_versions (
  id               TEXT PRIMARY KEY,
  common_action_id TEXT NOT NULL REFERENCES common_actions(id),
  version_number   INTEGER NOT NULL CHECK (version_number > 0),
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published')),
  action_config    TEXT NOT NULL DEFAULT '[]',
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  published_at     TEXT,
  UNIQUE (common_action_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_common_action_versions_action_status
  ON common_action_versions(common_action_id, status, version_number DESC);

CREATE TRIGGER IF NOT EXISTS trg_common_action_published_version_immutable
BEFORE UPDATE ON common_action_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published common action version is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_common_action_published_version_no_delete
BEFORE DELETE ON common_action_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published common action version cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS common_action_bindings (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  common_action_id         TEXT NOT NULL REFERENCES common_actions(id),
  common_action_version_id TEXT NOT NULL REFERENCES common_action_versions(id),
  consumer_type            TEXT NOT NULL,
  consumer_id              TEXT NOT NULL,
  consumer_path            TEXT NOT NULL DEFAULT '',
  created_by               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (line_account_id, consumer_type, consumer_id, consumer_path, common_action_id)
);

CREATE INDEX IF NOT EXISTS idx_common_action_bindings_action
  ON common_action_bindings(common_action_id, common_action_version_id);
CREATE INDEX IF NOT EXISTS idx_common_action_bindings_consumer
  ON common_action_bindings(line_account_id, consumer_type, consumer_id);

CREATE TABLE IF NOT EXISTS automation_runs (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id),
  automation_id         TEXT NOT NULL REFERENCES automation_definitions(id),
  automation_version_id TEXT NOT NULL REFERENCES automation_versions(id),
  friend_id             TEXT REFERENCES friends(id) ON DELETE SET NULL,
  source_event_id       TEXT NOT NULL,
  idempotency_key       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN (
                            'queued', 'running', 'waiting', 'success', 'partial',
                            'failed', 'cancelled', 'skipped_condition'
                          )),
  current_step          INTEGER NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  resume_at             TEXT,
  input_event_json      TEXT NOT NULL DEFAULT '{}',
  is_test               INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  started_at            TEXT,
  completed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (line_account_id, automation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_account_status_created
  ON automation_runs(line_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_created
  ON automation_runs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_friend_created
  ON automation_runs(friend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_waiting
  ON automation_runs(status, resume_at)
  WHERE status = 'waiting';

CREATE TRIGGER IF NOT EXISTS trg_automation_runs_no_delete
BEFORE DELETE ON automation_runs
BEGIN SELECT RAISE(ABORT, 'automation run history cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS automation_run_steps (
  id                       TEXT PRIMARY KEY,
  automation_run_id        TEXT NOT NULL REFERENCES automation_runs(id),
  step_key                 TEXT NOT NULL,
  action_type              TEXT NOT NULL,
  common_action_version_id TEXT REFERENCES common_action_versions(id),
  attempt_number           INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  idempotency_key          TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL DEFAULT 'queued'
                             CHECK (status IN (
                               'queued', 'running', 'waiting', 'success',
                               'failed', 'skipped', 'cancelled'
                             )),
  input_json               TEXT NOT NULL DEFAULT '{}',
  output_json              TEXT,
  error_code               TEXT,
  error_message            TEXT,
  retry_at                 TEXT,
  started_at               TEXT,
  completed_at             TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (automation_run_id, step_key, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run
  ON automation_run_steps(automation_run_id, step_key, attempt_number);
CREATE INDEX IF NOT EXISTS idx_automation_run_steps_retry
  ON automation_run_steps(status, retry_at)
  WHERE status IN ('queued', 'waiting', 'failed');

CREATE TRIGGER IF NOT EXISTS trg_automation_run_steps_no_delete
BEFORE DELETE ON automation_run_steps
BEGIN SELECT RAISE(ABORT, 'automation step history cannot be deleted'); END;
