-- Migration 050: multi-location salon booking
-- A LINE account can operate multiple salons. A shift belongs to one salon,
-- and the booking records the salon selected by the customer.

CREATE TABLE IF NOT EXISTS booking_locations (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  access          TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_booking_locations_account_sort
  ON booking_locations (line_account_id, sort_order);

ALTER TABLE staff_shifts
  ADD COLUMN location_id TEXT REFERENCES booking_locations(id);

ALTER TABLE bookings
  ADD COLUMN location_id TEXT REFERENCES booking_locations(id);

CREATE INDEX IF NOT EXISTS idx_shifts_location_date
  ON staff_shifts (location_id, work_date);

CREATE INDEX IF NOT EXISTS idx_bookings_location_starts
  ON bookings (location_id, starts_at);
