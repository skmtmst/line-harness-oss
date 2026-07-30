-- Migration 052: Salon booking management settings.
--
-- Staff shifts remain the single source of bookable dates/times. These tables
-- only control publication, customer actions, form fields, notifications and
-- optional Google Calendar synchronization.

ALTER TABLE google_calendar_connections ADD COLUMN line_account_id TEXT
  REFERENCES line_accounts(id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_account
  ON google_calendar_connections (line_account_id, created_at);

CREATE TABLE IF NOT EXISTS booking_management_settings (
  line_account_id                TEXT PRIMARY KEY,
  is_public                      INTEGER NOT NULL DEFAULT 1,
  allow_new_booking              INTEGER NOT NULL DEFAULT 1,
  allow_change_request           INTEGER NOT NULL DEFAULT 1,
  allow_cancel_request           INTEGER NOT NULL DEFAULT 1,
  reception_start_mode           TEXT NOT NULL DEFAULT 'always'
                                   CHECK (reception_start_mode IN ('always','relative','fixed')),
  reception_start_days_before    INTEGER,
  reception_start_at             TEXT,
  reception_end_mode             TEXT NOT NULL DEFAULT 'until_start'
                                   CHECK (reception_end_mode IN ('until_start','relative','fixed')),
  reception_end_minutes_before   INTEGER NOT NULL DEFAULT 0,
  reception_end_at               TEXT,
  change_deadline_minutes_before INTEGER NOT NULL DEFAULT 1440,
  cancel_deadline_minutes_before INTEGER NOT NULL DEFAULT 2880,
  slot_interval_minutes          INTEGER NOT NULL DEFAULT 30,
  calendar_view                  TEXT NOT NULL DEFAULT 'week'
                                   CHECK (calendar_view IN ('week','month')),
  calendar_connection_id         TEXT,
  google_sync_enabled            INTEGER NOT NULL DEFAULT 0,
  created_at                     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (calendar_connection_id) REFERENCES google_calendar_connections(id)
);

CREATE TABLE IF NOT EXISTS booking_form_fields (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  field_key        TEXT NOT NULL,
  label            TEXT NOT NULL,
  field_type       TEXT NOT NULL DEFAULT 'text'
                     CHECK (field_type IN ('text','tel','date','textarea')),
  placeholder      TEXT,
  is_required      INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_system        INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, field_key),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_booking_form_fields_account_sort
  ON booking_form_fields (line_account_id, sort_order, id);

CREATE TABLE IF NOT EXISTS booking_message_settings (
  line_account_id  TEXT NOT NULL,
  event_key        TEXT NOT NULL,
  message_text     TEXT NOT NULL,
  is_enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (line_account_id, event_key),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

CREATE TABLE IF NOT EXISTS booking_action_requests (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  booking_id            TEXT NOT NULL,
  friend_id             TEXT NOT NULL,
  request_type          TEXT NOT NULL CHECK (request_type IN ('change','cancel')),
  status                TEXT NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested','approved','rejected')),
  requested_location_id TEXT,
  requested_staff_id    TEXT,
  requested_menu_id     TEXT,
  requested_starts_at   TEXT,
  requested_ends_at     TEXT,
  requested_block_ends_at TEXT,
  customer_note         TEXT,
  requested_at          TEXT NOT NULL,
  decided_at            TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id)
);
CREATE INDEX IF NOT EXISTS idx_booking_action_requests_account_status
  ON booking_action_requests (line_account_id, status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_action_requests_one_pending
  ON booking_action_requests (booking_id, request_type)
  WHERE status = 'requested';

ALTER TABLE bookings ADD COLUMN customer_birthdate TEXT;
ALTER TABLE bookings ADD COLUMN custom_fields_json TEXT;
