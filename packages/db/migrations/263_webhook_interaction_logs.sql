-- V6 外部連携「やり取りの記録」。
--
-- Webhook設定そのものとは分けて、送った・受け取った1回ごとの結果を残す。
-- URLとシークレットは保存しない。送信内容は安全な再試行のため内部に保持するが、
-- 一覧APIへは返さず、画面の詳細にも本文を返さない。

CREATE TABLE IF NOT EXISTS webhook_interaction_logs (
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
      'response_5xx', 'processing_failed', 'unknown'
    )
  ),
  idempotency_key    TEXT NOT NULL,
  retry_of_id        TEXT REFERENCES webhook_interaction_logs(id) ON DELETE SET NULL,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_interactions_account_created
  ON webhook_interaction_logs (line_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_interactions_account_status
  ON webhook_interaction_logs (line_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_interactions_webhook
  ON webhook_interaction_logs (line_account_id, webhook_id, created_at DESC);
