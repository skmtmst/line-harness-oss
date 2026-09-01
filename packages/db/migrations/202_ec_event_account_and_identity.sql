-- ECイベントをLINEアカウントへ固定し、LINE未照合の顧客も失わず受け取れるようにする。
ALTER TABLE ec_events RENAME TO ec_events_before_account_scope;

CREATE TABLE ec_events (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  line_account_id   TEXT REFERENCES line_accounts(id),
  customer_id       TEXT,
  line_user_id      TEXT,
  friend_id         TEXT,
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'identity_pending', 'processing', 'processed', 'skipped', 'failed')),
  error_message     TEXT,
  received_at       TEXT NOT NULL,
  processed_at      TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (source, external_event_id),
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE SET NULL
);

INSERT INTO ec_events
  (id, source, external_event_id, event_type, line_account_id, customer_id,
   line_user_id, friend_id, payload, status, error_message, received_at, processed_at, updated_at)
SELECT e.id, e.source, e.external_event_id, e.event_type, f.line_account_id, e.customer_id,
       e.line_user_id, e.friend_id, e.payload, e.status, e.error_message,
       e.received_at, e.processed_at, e.updated_at
  FROM ec_events_before_account_scope e
  LEFT JOIN friends f ON f.id = e.friend_id;

DROP TABLE ec_events_before_account_scope;

CREATE INDEX idx_ec_events_status_received ON ec_events(status, received_at);
CREATE INDEX idx_ec_events_customer ON ec_events(customer_id, received_at DESC);
CREATE INDEX idx_ec_events_friend ON ec_events(friend_id, received_at DESC);
CREATE INDEX idx_ec_events_account_received ON ec_events(line_account_id, received_at DESC);
CREATE INDEX idx_ec_events_identity_pending
  ON ec_events(line_account_id, received_at DESC) WHERE status = 'identity_pending';
