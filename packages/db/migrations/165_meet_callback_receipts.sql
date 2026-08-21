-- Signed Meet callbacks are processed once per session to prevent replayed LINE sends.
CREATE TABLE IF NOT EXISTS meet_callback_receipts (
  session_id   TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  received_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meet_callback_receipts_received
  ON meet_callback_receipts(received_at);
