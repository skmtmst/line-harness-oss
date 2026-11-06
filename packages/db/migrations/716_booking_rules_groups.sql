-- B-344/B-349 approved 716. Store/menu rules and companion snapshots.
CREATE TABLE booking_deposit_rules (
 account_id TEXT NOT NULL REFERENCES line_accounts(id),scope_id TEXT NOT NULL DEFAULT '',rule_json TEXT NOT NULL CHECK(json_valid(rule_json)),
 inherit INTEGER NOT NULL DEFAULT 0 CHECK(inherit IN(0,1)),version INTEGER NOT NULL DEFAULT 1,updated_by TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(account_id,scope_id)
);
CREATE TABLE booking_cancellation_options (
 account_id TEXT PRIMARY KEY REFERENCES line_accounts(id),card_required_for TEXT NOT NULL DEFAULT 'all' CHECK(card_required_for IN('all','no_show_flagged','conditions')),
 charge_mode TEXT NOT NULL DEFAULT 'manual' CHECK(charge_mode IN('manual','auto')),version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE booking_groups (
 id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),
 start_mode TEXT NOT NULL DEFAULT 'parallel' CHECK(start_mode IN('parallel','sequential')),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_json TEXT NOT NULL,
 UNIQUE(line_account_id,friend_id,idempotency_key)
);
ALTER TABLE bookings ADD COLUMN group_id TEXT REFERENCES booking_groups(id);
ALTER TABLE bookings ADD COLUMN person_label TEXT;
CREATE INDEX bookings_group ON bookings(group_id);

ALTER TABLE bookings ADD COLUMN group_index INTEGER;
ALTER TABLE bookings ADD COLUMN deposit_snapshot_json TEXT;
ALTER TABLE bookings ADD COLUMN booking_payment_method_id TEXT REFERENCES booking_payment_methods(id);
