ALTER TABLE events ADD COLUMN makeup_rule_json TEXT NOT NULL DEFAULT '{"enabled":false,"cutoffHours":3,"validDays":30,"monthlyCap":2,"target":"same_kind","targetIds":[]}' CHECK(json_valid(makeup_rule_json));
ALTER TABLE event_bookings ADD COLUMN absence_reported_at TEXT;
CREATE TABLE booking_makeup_credits(
 id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),
 source_event_booking_id TEXT UNIQUE REFERENCES event_bookings(id),source_event_id TEXT NOT NULL REFERENCES events(id),entitlement_id TEXT REFERENCES booking_entitlements(id),
 expires_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','used','expired','revoked')),used_event_booking_id TEXT REFERENCES event_bookings(id),
 reason TEXT,granted_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,rule_snapshot_json TEXT NOT NULL CHECK(json_valid(rule_snapshot_json)),
 use_idempotency_key TEXT,use_request_json TEXT
);
CREATE INDEX makeup_friend_status ON booking_makeup_credits(line_account_id,friend_id,status,expires_at);
CREATE TRIGGER makeup_cancel_restore AFTER UPDATE OF status ON event_bookings WHEN NEW.status IN('cancelled','rejected','expired') AND OLD.status IN('requested','confirmed')
BEGIN UPDATE booking_makeup_credits SET status=CASE WHEN julianday(expires_at)>julianday('now') THEN 'open' ELSE 'expired' END,used_event_booking_id=NULL,version=version+1,use_idempotency_key=NULL,use_request_json=NULL
 WHERE used_event_booking_id=NEW.id AND status='used' AND (NEW.cancelled_by IN('admin','system') OR julianday('now') <= julianday((SELECT starts_at FROM event_slots WHERE id=NEW.slot_id))-COALESCE(json_extract(rule_snapshot_json,'$.cutoffHours'),3)/24.0); END;
