ALTER TABLE bookings ADD COLUMN routing_rule_index INTEGER;
ALTER TABLE bookings ADD COLUMN routing_form_version_id TEXT REFERENCES form_versions(id);
CREATE TABLE booking_routing_staff_groups(id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id),name TEXT NOT NULL,staff_ids_json TEXT NOT NULL CHECK(json_valid(staff_ids_json)),version INTEGER NOT NULL DEFAULT 1);
