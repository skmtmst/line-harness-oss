-- LINE Webhook の再送を二重処理せず、処理結果だけを安全に追跡する台帳。
-- 本文・メッセージ内容・LINEユーザーIDなどの個人情報は保存しない。
CREATE TABLE IF NOT EXISTS line_webhook_events (
  webhook_event_id TEXT PRIMARY KEY,
  line_account_id  TEXT,
  event_type       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'processing', 'succeeded', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT CHECK (
                     last_error IS NULL OR
                     last_error IN ('line_api_error', 'db_error', 'unknown')
                   ),
  received_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_line_webhook_events_status
  ON line_webhook_events(status, received_at);

CREATE INDEX IF NOT EXISTS idx_line_webhook_events_account
  ON line_webhook_events(line_account_id, received_at DESC);
