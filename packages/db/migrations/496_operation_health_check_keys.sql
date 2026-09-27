-- migration-policy: table-rebuild
-- W: 運用状態の確認項目を3つ増やす（v6-32 §5-3・§6-2）。
--   monitoring_heartbeat … 見張りの仕組み自体が5分ごとに動いているか
--   infra_canary         … データの置き場（D1・R2・Queue）へ実際に読み書きして試す
--   credential_expiry    … LINEの鍵の期限が近づいていないか（14日前から注意）
-- check_key の CHECK 制約を広げるため、結果表と異常表を作り直す。
-- 既存の行はそのまま引き継ぐ。

CREATE TABLE operation_health_results_new (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES operation_health_runs(id) ON DELETE CASCADE,
  check_key      TEXT NOT NULL CHECK (check_key IN (
    'line_connection', 'message_quota', 'external_integrations',
    'webhook', 'dispatch_jobs', 'friend_change',
    'monitoring_heartbeat', 'infra_canary', 'credential_expiry'
  )),
  status         TEXT NOT NULL CHECK (status IN ('normal', 'warning', 'danger', 'unknown')),
  summary        TEXT NOT NULL,
  value_json     TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  threshold_json TEXT CHECK (threshold_json IS NULL OR json_valid(threshold_json)),
  source         TEXT NOT NULL,
  observed_at    TEXT NOT NULL,
  UNIQUE (run_id, check_key)
);

INSERT INTO operation_health_results_new (
  id, run_id, check_key, status, summary, value_json, threshold_json, source, observed_at
)
SELECT
  id, run_id, check_key, status, summary, value_json, threshold_json, source, observed_at
FROM operation_health_results;

DROP TABLE operation_health_results;

ALTER TABLE operation_health_results_new RENAME TO operation_health_results;

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、496 固有名で貼り直す。
CREATE INDEX idx_operation_health_results_run_v496
  ON operation_health_results(run_id, check_key);

CREATE TABLE operation_alerts_new (
  id                   TEXT PRIMARY KEY,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  check_key            TEXT NOT NULL CHECK (check_key IN (
    'line_connection', 'message_quota', 'external_integrations',
    'webhook', 'dispatch_jobs', 'friend_change',
    'monitoring_heartbeat', 'infra_canary', 'credential_expiry'
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

INSERT INTO operation_alerts_new (
  id, line_account_id, check_key, status, severity, summary, source_run_id,
  first_detected_at, last_detected_at, acknowledged_at, acknowledged_by_id,
  acknowledgement_note, resolved_at, version, reopened_count, created_at, updated_at
)
SELECT
  id, line_account_id, check_key, status, severity, summary, source_run_id,
  first_detected_at, last_detected_at, acknowledged_at, acknowledged_by_id,
  acknowledgement_note, resolved_at, version, reopened_count, created_at, updated_at
FROM operation_alerts;

DROP TABLE operation_alerts;

ALTER TABLE operation_alerts_new RENAME TO operation_alerts;

CREATE INDEX idx_operation_alerts_account_status_v496
  ON operation_alerts(line_account_id, status, updated_at DESC);
