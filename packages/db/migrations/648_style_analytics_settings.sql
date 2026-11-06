-- B-316 / M9。祝日は店のタイムゾーンに対する日付。
CREATE TABLE style_holidays(line_account_id TEXT NOT NULL REFERENCES line_accounts(id), date TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(line_account_id,date));
CREATE TABLE style_targets(line_account_id TEXT NOT NULL REFERENCES line_accounts(id), metric TEXT NOT NULL, period TEXT NOT NULL, value REAL NOT NULL CHECK(value>=0), PRIMARY KEY(line_account_id,metric,period));
CREATE TABLE booking_page_views(id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id), menu_id TEXT REFERENCES menus(id), friend_id TEXT REFERENCES friends(id), entry_point TEXT, viewed_at TEXT NOT NULL);
CREATE INDEX idx_style_page_views ON booking_page_views(line_account_id,viewed_at);
