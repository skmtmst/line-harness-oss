-- 運用状態の緊急停止を、ブラウザのlocalStorageではなくサーバーの正本へ移す。
-- scope_key='*' は全アカウント、その他はLINEアカウントID。
CREATE TABLE IF NOT EXISTS operation_control_sets (
  scope_key          TEXT PRIMARY KEY,
  line_account_id    TEXT REFERENCES line_accounts(id),
  version            INTEGER NOT NULL DEFAULT 1,
  states_json        TEXT NOT NULL,
  active_incident_id TEXT,
  reason             TEXT,
  actor_id            TEXT,
  stopped_at         TEXT,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_incidents (
  id                 TEXT PRIMARY KEY,
  scope_key          TEXT NOT NULL,
  line_account_id    TEXT REFERENCES line_accounts(id),
  status             TEXT NOT NULL CHECK (status IN ('preparing', 'stopped', 'resolved', 'failed')),
  capabilities_json  TEXT NOT NULL,
  reason             TEXT NOT NULL,
  detail             TEXT,
  actor_id            TEXT NOT NULL,
  resolved_by_actor_id TEXT,
  control_version    INTEGER,
  error_message      TEXT,
  stopped_at         TEXT,
  resolved_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_incidents_scope_created
  ON operation_incidents(scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operation_incidents_status_created
  ON operation_incidents(status, created_at DESC);

-- 停止・復旧ボタンの二重送信や通信再試行で、同じ不可逆操作を二度実行しない。
CREATE TABLE IF NOT EXISTS operation_idempotency_keys (
  key             TEXT PRIMARY KEY,
  action          TEXT NOT NULL CHECK (action IN ('stop', 'restore')),
  actor_id        TEXT NOT NULL,
  scope_key       TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL DEFAULT 0,
  response_body   TEXT NOT NULL DEFAULT '',
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_idempotency_expires
  ON operation_idempotency_keys(expires_at);
