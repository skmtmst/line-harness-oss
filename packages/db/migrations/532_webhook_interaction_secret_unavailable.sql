-- migration-policy: table-rebuild
-- d23b R415: 送信Webhookの再送で、こちら側の署名用の合言葉が読めなかった失敗を
-- 「相手から返事がない(connection_failed)」と区別するため、failure_reason に
-- 'secret_unavailable' を足す。監査項目は台帳側(error_code)にはあるが履歴側に
-- 無かったため、履歴と画面で同じ言葉を出せるようにする。
-- 既存の行はそのまま引き継ぐ。

CREATE TABLE webhook_interaction_logs_new (
  id                 TEXT PRIMARY KEY,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
  webhook_id         TEXT,
  webhook_name       TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  trigger_summary    TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'retried')),
  request_body_json  TEXT,
  response_status    INTEGER,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  duration_ms        INTEGER,
  failure_reason     TEXT CHECK (
    failure_reason IS NULL OR failure_reason IN (
      'connection_failed', 'response_4xx', 'response_429',
      'response_5xx', 'processing_failed', 'unknown', 'secret_unavailable'
    )
  ),
  idempotency_key    TEXT NOT NULL,
  retry_of_id        TEXT REFERENCES webhook_interaction_logs(id) ON DELETE SET NULL,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  created_at         TEXT NOT NULL
);

INSERT INTO webhook_interaction_logs_new (
  id, line_account_id, direction, webhook_id, webhook_name, event_type,
  trigger_summary, status, request_body_json, response_status, attempt_count,
  duration_ms, failure_reason, idempotency_key, retry_of_id,
  started_at, completed_at, created_at
)
SELECT
  id, line_account_id, direction, webhook_id, webhook_name, event_type,
  trigger_summary, status, request_body_json, response_status, attempt_count,
  duration_ms, failure_reason, idempotency_key, retry_of_id,
  started_at, completed_at, created_at
FROM webhook_interaction_logs;

DROP TABLE webhook_interaction_logs;

ALTER TABLE webhook_interaction_logs_new RENAME TO webhook_interaction_logs;

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、532 固有名で貼り直す。
CREATE INDEX idx_webhook_interactions_account_created_v532
  ON webhook_interaction_logs (line_account_id, created_at DESC);
CREATE INDEX idx_webhook_interactions_account_status_v532
  ON webhook_interaction_logs (line_account_id, status, created_at DESC);
CREATE INDEX idx_webhook_interactions_connection_period_v532
  ON webhook_interaction_logs(line_account_id, webhook_id, created_at DESC, status);
CREATE INDEX idx_webhook_interactions_webhook_v532
  ON webhook_interaction_logs (line_account_id, webhook_id, created_at DESC);
