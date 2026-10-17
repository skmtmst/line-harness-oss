-- B-324: 署名確認後の最小データだけを保持する。原文・署名・顧客本文は保存しない。
ALTER TABLE booking_payments ADD COLUMN refunded_at TEXT;
ALTER TABLE booking_payments ADD COLUMN receipt_url TEXT;

CREATE TABLE booking_payment_events (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payment_id TEXT REFERENCES booking_payments(id) ON DELETE SET NULL,
  provider_payment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('paid','refunded','expired','other')),
  outcome TEXT NOT NULL CHECK(outcome IN ('paid','failed','refunded','expired')),
  amount INTEGER CHECK(amount IS NULL OR (typeof(amount)='integer' AND amount>=0)),
  currency TEXT,
  receipt_url TEXT,
  received_at TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'failed' CHECK(result IN ('applied','duplicate','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  repeat_count INTEGER NOT NULL DEFAULT 0 CHECK(repeat_count>=0),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  lease_token TEXT,
  lease_until TEXT,
  applied_at TEXT,
  error_code TEXT,
  UNIQUE(provider,line_account_id,provider_event_id)
);
CREATE INDEX idx_booking_payment_events_account_received ON booking_payment_events(line_account_id,received_at DESC,id);

CREATE TABLE booking_payment_event_replays (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES booking_payment_events(id),
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('applied','duplicate','failed')),
  error_code TEXT,
  UNIQUE(event_id,source_version)
);
