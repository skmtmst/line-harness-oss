-- #938 監査是正 N-369/N-370/N-375: 送信Webhookの durable outbox と自動停止。
--
-- 直す前はイベント発生のたびに event-bus が fetch を逐次に投げ、
-- 送り直しもリクエスト内の数秒待ちだけだった。Worker が途中で止まると
-- 送り残しを誰も拾わず、連続失敗はカウンタが増えるだけで止まらなかった。
--
-- `outgoing_webhook_deliveries` は「台帳へ先に積んでから送る」配送口。
-- (webhook_id, idempotency_key) の UNIQUE で、イベント再発火・cron 再実行・
-- Worker中断後の再開が同じ配送を二重に作らない。status=retry_wait の行は
-- delivery レーン(5分)の sweep が `next_retry_at` を過ぎた分だけ回収する。

CREATE TABLE IF NOT EXISTS outgoing_webhook_deliveries (
  id                   TEXT PRIMARY KEY,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  webhook_id           TEXT NOT NULL REFERENCES outgoing_webhooks(id) ON DELETE CASCADE,
  event_type           TEXT NOT NULL,
  body_json            TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'retry_wait', 'delivered', 'failed')),
  attempts             INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  /** 初回を含む試行の上限。1 + min(max_retries, 7)（要件26 §6-4 の最大8回）。 */
  max_attempts         INTEGER NOT NULL CHECK (max_attempts >= 1),
  next_retry_at        TEXT,
  /** sweep の引き取り証。取り掛かったまま止まった行を lease_until で見放す。 */
  lease_token          TEXT,
  lease_until          TEXT,
  last_response_status INTEGER,
  error_code           TEXT,
  /** 相手の応答本文や秘密値は残さない。運用者が次の行動を選べる文だけ。 */
  error_message_safe   TEXT,
  queued_at            TEXT NOT NULL,
  delivered_at         TEXT,
  failed_at            TEXT,
  updated_at           TEXT NOT NULL,
  UNIQUE (webhook_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_outgoing_webhook_deliveries_due
  ON outgoing_webhook_deliveries(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_outgoing_webhook_deliveries_webhook
  ON outgoing_webhook_deliveries(webhook_id, queued_at DESC);

-- 連続失敗で自動停止した記録。手動で止めた行と区別し、再有効化で消える。
ALTER TABLE outgoing_webhooks ADD COLUMN auto_stopped_at TEXT;
