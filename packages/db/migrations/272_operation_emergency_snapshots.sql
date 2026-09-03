-- 緊急停止の状態と履歴を、ブラウザの localStorage ではなくサーバーへ保存する。
-- scope_key='*' は全アカウント、それ以外は LINE アカウント ID。
CREATE TABLE IF NOT EXISTS operation_control_sets (
  scope_key          TEXT PRIMARY KEY,
  line_account_id    TEXT REFERENCES line_accounts(id),
  version            INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  states_json        TEXT NOT NULL CHECK (json_valid(states_json)),
  active_incident_id TEXT,
  reason             TEXT,
  actor_id            TEXT,
  stopped_at         TEXT,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_incidents (
  id                    TEXT PRIMARY KEY,
  scope_key             TEXT NOT NULL,
  line_account_id       TEXT REFERENCES line_accounts(id),
  status                TEXT NOT NULL CHECK (status IN ('preparing', 'stopped', 'resolved', 'failed')),
  capabilities_json     TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  reason                TEXT NOT NULL,
  detail                TEXT,
  actor_id               TEXT NOT NULL,
  resolved_by_actor_id  TEXT,
  control_version       INTEGER,
  before_snapshot_json  TEXT NOT NULL CHECK (json_valid(before_snapshot_json)),
  stopped_snapshot_json TEXT CHECK (stopped_snapshot_json IS NULL OR json_valid(stopped_snapshot_json)),
  restored_snapshot_json TEXT CHECK (restored_snapshot_json IS NULL OR json_valid(restored_snapshot_json)),
  error_message         TEXT,
  stopped_at            TEXT,
  resolved_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_incidents_scope_created
  ON operation_incidents(scope_key, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_operation_incidents_status_created
  ON operation_incidents(status, created_at DESC, id DESC);
