-- 管理画面からの外部送信を、通信切断や再試行で二重送信しないための予約表。
CREATE TABLE IF NOT EXISTS outbound_send_requests (
  idempotency_key TEXT PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  resource_id     TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('in_progress', 'succeeded')),
  response_id     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbound_send_requests_created
  ON outbound_send_requests(created_at);
