-- B-344/API組3: 部分返金の累計・理由・操作者と予約連結の履歴。DB適用は別工程。
ALTER TABLE booking_payments ADD COLUMN refunded_amount INTEGER NOT NULL DEFAULT 0
  CHECK(typeof(refunded_amount)='integer' AND refunded_amount>=0 AND refunded_amount<=amount);
ALTER TABLE booking_payments ADD COLUMN actor_label TEXT;
ALTER TABLE booking_payments ADD COLUMN action_reason TEXT;
UPDATE booking_payments SET refunded_amount=amount WHERE status='refunded';
ALTER TABLE booking_payment_events ADD COLUMN refunded_amount INTEGER
  CHECK(refunded_amount IS NULL OR (typeof(refunded_amount)='integer' AND refunded_amount>0 AND refunded_amount<=amount));
UPDATE booking_payment_events SET refunded_amount=amount WHERE outcome='refunded' AND amount>0;

CREATE TABLE booking_payment_refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES booking_payments(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
  requested_amount INTEGER CHECK(requested_amount IS NULL OR (typeof(requested_amount)='integer' AND requested_amount>0)),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  notify_line INTEGER NOT NULL DEFAULT 0 CHECK(notify_line IN (0,1)),
  notification_status TEXT NOT NULL CHECK(notification_status IN ('not_requested','simulated','unavailable')),
  created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
  UNIQUE(payment_id,idempotency_key)
);
CREATE INDEX idx_booking_payment_refunds_account_date ON booking_payment_refunds(line_account_id,created_at);
CREATE TABLE booking_payment_booking_links (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES booking_payments(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL)
);
CREATE INDEX idx_booking_payment_booking_links_payment ON booking_payment_booking_links(payment_id,created_at);
