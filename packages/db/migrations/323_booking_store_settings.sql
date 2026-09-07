-- 機能28: 店舗共通の予約設定、複数営業時間、例外日、価格種別。

CREATE TABLE IF NOT EXISTS booking_settings (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL UNIQUE REFERENCES line_accounts(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo' CHECK (length(trim(timezone)) > 0),
  booking_window_days INTEGER NOT NULL DEFAULT 60 CHECK (booking_window_days BETWEEN 1 AND 365),
  cutoff_minutes_before INTEGER NOT NULL DEFAULT 1440 CHECK (cutoff_minutes_before BETWEEN 0 AND 43200),
  cancel_deadline_minutes_before INTEGER NOT NULL DEFAULT 1440 CHECK (cancel_deadline_minutes_before BETWEEN 0 AND 43200),
  max_active_bookings_per_friend INTEGER NOT NULL DEFAULT 1 CHECK (max_active_bookings_per_friend BETWEEN 1 AND 100),
  approval_mode TEXT NOT NULL DEFAULT 'automatic' CHECK (approval_mode IN ('automatic', 'manual')),
  hold_minutes INTEGER NOT NULL DEFAULT 15 CHECK (hold_minutes BETWEEN 1 AND 1440),
  slot_granularity_minutes INTEGER NOT NULL DEFAULT 15 CHECK (slot_granularity_minutes IN (5, 10, 15, 30, 60)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT OR IGNORE INTO booking_settings (id, line_account_id)
SELECT 'booking-settings-' || id, id FROM line_accounts;

CREATE TABLE IF NOT EXISTS booking_business_hours (
  id TEXT PRIMARY KEY,
  booking_settings_id TEXT NOT NULL REFERENCES booking_settings(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL CHECK (
    start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(start_time, 1, 2) <= '23'
  ),
  end_time TEXT NOT NULL CHECK (
    end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(end_time, 1, 2) <= '23'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK (start_time < end_time),
  UNIQUE (booking_settings_id, weekday, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_booking_business_hours_setting_weekday
  ON booking_business_hours(booking_settings_id, weekday, start_time);

CREATE TABLE IF NOT EXISTS booking_resources (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 1000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_booking_resources_account_active
  ON booking_resources(line_account_id, is_active, id);

CREATE TABLE IF NOT EXISTS booking_availability_exceptions (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('store', 'staff', 'resource')),
  scope_id TEXT,
  date_from TEXT NOT NULL CHECK (date_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  date_to TEXT NOT NULL CHECK (date_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('closed', 'custom_hours', 'open')),
  hours_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK (date_from <= date_to),
  CHECK ((scope_kind = 'store' AND scope_id IS NULL) OR (scope_kind != 'store' AND length(trim(scope_id)) > 0)),
  CHECK ((kind = 'closed' AND hours_json = '[]') OR kind != 'closed')
);

CREATE INDEX IF NOT EXISTS idx_booking_exceptions_account_dates
  ON booking_availability_exceptions(line_account_id, date_from, date_to, scope_kind);

ALTER TABLE menus ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'fixed'
  CHECK (price_mode IN ('fixed', 'free', 'inquiry') AND (price_mode = 'fixed' OR base_price = 0));
ALTER TABLE menus ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
