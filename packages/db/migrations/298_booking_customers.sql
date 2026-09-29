-- migration-policy: table-rebuild
-- LINE未連携の電話客を、偽のfriends行を作らず予約へ結び付ける。
CREATE TABLE booking_customers (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id             TEXT REFERENCES friends(id) ON DELETE SET NULL,
  display_name          TEXT NOT NULL,
  phone_normalized_hash TEXT NOT NULL,
  phone_encrypted       TEXT NOT NULL,
  phone_last4           TEXT NOT NULL,
  email_encrypted       TEXT,
  pet_name              TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX idx_booking_customers_account_phone
  ON booking_customers(line_account_id, phone_normalized_hash);
CREATE INDEX idx_booking_customers_account_name
  ON booking_customers(line_account_id, display_name);

CREATE TABLE bookings_next (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL,
  friend_id                    TEXT,
  booking_customer_id          TEXT REFERENCES booking_customers(id) ON DELETE RESTRICT,
  staff_id                     TEXT NOT NULL,
  menu_id                      TEXT NOT NULL,
  starts_at                    TEXT NOT NULL,
  ends_at                      TEXT NOT NULL,
  block_ends_at                TEXT NOT NULL,
  status                       TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','expired','cancelled','completed','no_show')),
  customer_note                TEXT,
  internal_note                TEXT,
  price_at_booking             INTEGER NOT NULL,
  requested_at                 TEXT NOT NULL,
  decided_at                   TEXT,
  decided_by_staff_id          TEXT,
  external_event_id            TEXT,
  external_calendar_id         TEXT,
  source                       TEXT NOT NULL DEFAULT 'liff'
                                 CHECK (source IN ('liff','phone','counter','operator','import')),
  created_by_staff_id          TEXT,
  updated_by_staff_id          TEXT,
  lock_version                 INTEGER NOT NULL DEFAULT 0,
  notification_policy_snapshot TEXT NOT NULL DEFAULT '{}'
                                 CHECK (json_valid(notification_policy_snapshot)),
  cancelled_at                 TEXT,
  completed_at                 TEXT,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id),
  FOREIGN KEY (created_by_staff_id) REFERENCES staff(id),
  FOREIGN KEY (updated_by_staff_id) REFERENCES staff(id),
  CHECK (friend_id IS NOT NULL OR booking_customer_id IS NOT NULL)
);

INSERT INTO bookings_next (
  id, line_account_id, friend_id, staff_id, menu_id,
  starts_at, ends_at, block_ends_at, status,
  customer_note, internal_note, price_at_booking,
  requested_at, decided_at, decided_by_staff_id,
  external_event_id, external_calendar_id, created_at, updated_at
)
SELECT
  id, line_account_id, friend_id, staff_id, menu_id,
  starts_at, ends_at, block_ends_at, status,
  customer_note, internal_note, price_at_booking,
  requested_at, decided_at, decided_by_staff_id,
  external_event_id, external_calendar_id, created_at, updated_at
FROM bookings;

-- bookings を参照する既存リマインドを残したまま親表を落とすと、
-- foreign_keys=ON の環境では制約違反になる。参照先を新表へ付け替えてから入れ替える。
CREATE TABLE booking_reminders_next (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES bookings_next(id),
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);

INSERT INTO booking_reminders_next (
  id, booking_id, kind, scheduled_at, sent_at, status, retry_count, last_error
)
SELECT
  id, booking_id, kind, scheduled_at, sent_at, status, retry_count, last_error
FROM booking_reminders;

DROP TABLE booking_reminders;
DROP TABLE bookings;
ALTER TABLE bookings_next RENAME TO bookings;
ALTER TABLE booking_reminders_next RENAME TO booking_reminders;

-- 再構築前の索引と同名にすると、適用判定で作成が飛ばされるため新しい名前にする。
CREATE INDEX idx_bookings_v298_account_status_starts
  ON bookings(line_account_id, status, starts_at);
CREATE INDEX idx_bookings_v298_staff_overlap
  ON bookings(staff_id, status, starts_at, block_ends_at);
CREATE INDEX idx_bookings_v298_friend_starts
  ON bookings(friend_id, starts_at DESC);
CREATE INDEX idx_bookings_v298_customer_starts
  ON bookings(booking_customer_id, starts_at DESC);
CREATE INDEX idx_booking_reminders_v298_status_scheduled
  ON booking_reminders(status, scheduled_at);
