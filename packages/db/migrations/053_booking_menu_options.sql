-- Migration 053: booking menu options
-- オプション商品をメニュー・店舗に紐づけ、予約時の内容はスナップショット保存する。

CREATE TABLE IF NOT EXISTS booking_options (
  id                          TEXT PRIMARY KEY,
  line_account_id             TEXT NOT NULL,
  name                        TEXT NOT NULL,
  description                 TEXT,
  additional_price            INTEGER NOT NULL DEFAULT 0,
  additional_duration_minutes INTEGER NOT NULL DEFAULT 0,
  sort_order                  INTEGER NOT NULL DEFAULT 0,
  is_active                   INTEGER NOT NULL DEFAULT 1,
  deleted_at                  TEXT,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_booking_options_account_sort
  ON booking_options (line_account_id, sort_order);

CREATE TABLE IF NOT EXISTS booking_option_menus (
  option_id TEXT NOT NULL,
  menu_id   TEXT NOT NULL,
  PRIMARY KEY (option_id, menu_id),
  FOREIGN KEY (option_id) REFERENCES booking_options(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS booking_option_locations (
  option_id   TEXT NOT NULL,
  location_id TEXT NOT NULL,
  PRIMARY KEY (option_id, location_id),
  FOREIGN KEY (option_id) REFERENCES booking_options(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES booking_locations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS booking_selected_options (
  booking_id                  TEXT NOT NULL,
  option_id                   TEXT NOT NULL,
  option_name                 TEXT NOT NULL,
  additional_price            INTEGER NOT NULL,
  additional_duration_minutes INTEGER NOT NULL,
  PRIMARY KEY (booking_id, option_id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES booking_options(id)
);

CREATE INDEX IF NOT EXISTS idx_booking_selected_options_booking
  ON booking_selected_options (booking_id);

ALTER TABLE booking_action_requests ADD COLUMN requested_options_json TEXT;
