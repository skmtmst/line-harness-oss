CREATE TABLE booking_series (
 id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),menu_id TEXT NOT NULL REFERENCES menus(id),
 staff_policy TEXT NOT NULL CHECK(staff_policy IN('same','auto')),rule_json TEXT NOT NULL CHECK(json_valid(rule_json)),created_by TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','ended','cancelled')),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,request_json TEXT NOT NULL,UNIQUE(line_account_id,created_by,idempotency_key)
);
ALTER TABLE bookings ADD COLUMN series_id TEXT REFERENCES booking_series(id);
ALTER TABLE bookings ADD COLUMN series_index INTEGER;
ALTER TABLE menus ADD COLUMN customer_recurring_enabled INTEGER NOT NULL DEFAULT 0 CHECK(customer_recurring_enabled IN(0,1));
ALTER TABLE menus ADD COLUMN recurring_freqs_json TEXT NOT NULL DEFAULT '["weekly"]' CHECK(json_valid(recurring_freqs_json));
ALTER TABLE menus ADD COLUMN recurring_max_count INTEGER NOT NULL DEFAULT 12 CHECK(recurring_max_count BETWEEN 2 AND 12);
CREATE INDEX bookings_series ON bookings(series_id,series_index);
-- batch 内の条件付き書込が0件なら CHECK で全体を戻す。各取引内で削除する。
CREATE TABLE booking_batch_assertions(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));
