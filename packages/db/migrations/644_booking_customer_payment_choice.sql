-- B-316: API組3。既存の値・時刻・店/メニューの対応を全て保存する。
-- migration-policy: table-rebuild
CREATE TABLE booking_payment_configs_new (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'none' CHECK(mode IN ('none','onsite','online','customer_choice')),
  provider TEXT NOT NULL DEFAULT 'none',
  hold_minutes INTEGER NOT NULL DEFAULT 30 CHECK(hold_minutes BETWEEN 5 AND 1440),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO booking_payment_configs_new SELECT * FROM booking_payment_configs;
DROP TABLE booking_payment_configs;
ALTER TABLE booking_payment_configs_new RENAME TO booking_payment_configs;
CREATE TABLE booking_payment_menu_settings_new (
  menu_id TEXT PRIMARY KEY REFERENCES menus(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('none','onsite','online','customer_choice')),
  provider TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO booking_payment_menu_settings_new SELECT * FROM booking_payment_menu_settings;
DROP TABLE booking_payment_menu_settings;
ALTER TABLE booking_payment_menu_settings_new RENAME TO booking_payment_menu_settings;
-- 予約した本人の選択を固定。あとで店の設定が変わっても支払い方法は変えない。
CREATE TABLE booking_payment_choices (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('onsite','online')),
  provider TEXT NOT NULL CHECK(provider IN ('onsite','stripe')),
  hold_minutes INTEGER NOT NULL CHECK(hold_minutes BETWEEN 5 AND 1440)
);
