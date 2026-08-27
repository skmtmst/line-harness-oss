-- 広告成果を送る前に1行確保し、同じ元イベントの二重送信を防ぐ。
ALTER TABLE ad_conversion_logs ADD COLUMN idempotency_key TEXT;
ALTER TABLE ad_conversion_logs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_conversion_logs ADD COLUMN next_retry_at TEXT;
ALTER TABLE ad_conversion_logs ADD COLUMN updated_at TEXT;

UPDATE ad_conversion_logs
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_conversion_logs_idempotency
  ON ad_conversion_logs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_retry
  ON ad_conversion_logs(status, next_retry_at);
