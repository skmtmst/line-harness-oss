-- N-023: 個別送信の失敗を、安全な再試行可否と一緒に残す。
--
-- 旧表の in_progress は、LINE受理後に応答だけ失った可能性を否定できない。
-- そのため移行時も in_progress のまま保持し、自動再送の対象にはしない。
DROP INDEX IF EXISTS idx_outbound_send_requests_created;

ALTER TABLE outbound_send_requests RENAME TO outbound_send_requests_legacy_409;

CREATE TABLE outbound_send_requests (
  idempotency_key TEXT PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  resource_id     TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('in_progress', 'succeeded', 'failed', 'unknown')),
  response_id     TEXT,
  failure_code    TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  retryable       INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  next_retry_at   TEXT,
  last_failed_at  TEXT,
  lease_token     TEXT,
  lease_expires_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT,
  CHECK (
    (status = 'succeeded' AND response_id IS NOT NULL AND completed_at IS NOT NULL)
    OR status != 'succeeded'
  ),
  CHECK (
    (status IN ('failed', 'unknown') AND failure_code IS NOT NULL AND last_failed_at IS NOT NULL)
    OR status NOT IN ('failed', 'unknown')
  ),
  CHECK (status != 'unknown' OR retryable = 0)
);

INSERT INTO outbound_send_requests (
  idempotency_key, channel, resource_id, payload_hash, status, response_id,
  attempt_count, retryable, created_at, updated_at, completed_at
)
SELECT
  idempotency_key, channel, resource_id, payload_hash, status, response_id,
  1, 0, created_at, updated_at, completed_at
FROM outbound_send_requests_legacy_409;

DROP TABLE outbound_send_requests_legacy_409;

CREATE INDEX idx_outbound_send_requests_created
  ON outbound_send_requests(created_at);

CREATE INDEX idx_outbound_send_requests_account_failure
  ON outbound_send_requests(line_account_id, status, next_retry_at, updated_at DESC);

CREATE INDEX idx_outbound_send_requests_active_lease
  ON outbound_send_requests(status, lease_expires_at)
  WHERE status = 'in_progress';
