-- EC-CUBE / Stripe から受信したECイベントの冪等処理台帳。
-- external_event_id は送信元で決定し、同一イベントのLINE重複送信を防ぐ。
CREATE TABLE IF NOT EXISTS ec_events (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  customer_id       TEXT,
  line_user_id      TEXT NOT NULL,
  friend_id         TEXT,
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processing', 'processed', 'skipped', 'failed')),
  error_message     TEXT,
  received_at       TEXT NOT NULL,
  processed_at      TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (source, external_event_id),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ec_events_status_received
  ON ec_events(status, received_at);
CREATE INDEX IF NOT EXISTS idx_ec_events_customer
  ON ec_events(customer_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ec_events_friend
  ON ec_events(friend_id, received_at DESC);

