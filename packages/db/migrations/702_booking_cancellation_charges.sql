CREATE TABLE booking_payment_methods (
 id TEXT PRIMARY KEY, friend_id TEXT NOT NULL REFERENCES friends(id),line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
 setup_id TEXT NOT NULL UNIQUE, stripe_customer_id TEXT, stripe_payment_method_id TEXT,card_brand TEXT,card_last4 TEXT,
 test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','ready','detached')),
 idempotency_key TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(line_account_id,friend_id,idempotency_key)
);
CREATE TABLE booking_charges (
 -- 支払の証跡のIDは削除後も残す。顧客・予約・店へのFKで削除を妨げない。
 id TEXT PRIMARY KEY,booking_id TEXT NOT NULL,line_account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('cancellation_fee','no_show_fee')),amount INTEGER NOT NULL CHECK(amount>=0),
 policy_snapshot_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','processing','succeeded','failed','unknown','waived','refunded')),
 reason TEXT,actor_staff_id TEXT,stripe_payment_intent_id TEXT,idempotency_key TEXT,version INTEGER NOT NULL DEFAULT 1,
 test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(booking_id,kind),UNIQUE(line_account_id,idempotency_key)
);
CREATE TABLE booking_cancellation_events (
 id TEXT PRIMARY KEY,charge_id TEXT NOT NULL REFERENCES booking_charges(id),actor_id TEXT,action TEXT NOT NULL,reason TEXT,created_at TEXT NOT NULL
);
CREATE TRIGGER booking_cancellation_fee AFTER UPDATE OF status ON bookings
WHEN NEW.status IN('cancelled','no_show') AND OLD.status!=NEW.status AND NEW.policy_snapshot_json IS NOT NULL
 AND json_extract(NEW.policy_snapshot_json,'$.enabled')=1 AND NOT EXISTS(SELECT 1 FROM booking_entitlement_uses WHERE booking_id=NEW.id)
BEGIN INSERT OR IGNORE INTO booking_charges(id,booking_id,line_account_id,kind,amount,policy_snapshot_json,status,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.id,NEW.line_account_id,CASE WHEN NEW.status='no_show' THEN 'no_show_fee' ELSE 'cancellation_fee' END,
 CAST(NEW.price_at_booking * (CASE WHEN NEW.status='no_show' THEN json_extract(NEW.policy_snapshot_json,'$.noShowPercent')
 ELSE COALESCE((SELECT json_extract(value,'$.percent') FROM json_each(NEW.policy_snapshot_json,'$.tiers')
 WHERE (json_extract(value,'$.beforeHours')=0 OR julianday(NEW.starts_at)>=julianday(COALESCE(NEW.decided_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')))+json_extract(value,'$.beforeHours')/24.0)
 ORDER BY json_extract(value,'$.beforeHours') DESC LIMIT 1),0) END)/100 AS INTEGER),
 NEW.policy_snapshot_json,'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE NEW.price_at_booking>0 AND (NEW.cancellation_reason IS NULL OR NEW.cancellation_reason NOT IN('store','store_cancelled'))
 AND NEW.price_at_booking*(CASE WHEN NEW.status='no_show' THEN json_extract(NEW.policy_snapshot_json,'$.noShowPercent') ELSE COALESCE((SELECT json_extract(value,'$.percent') FROM json_each(NEW.policy_snapshot_json,'$.tiers') WHERE (json_extract(value,'$.beforeHours')=0 OR julianday(NEW.starts_at)>=julianday(COALESCE(NEW.decided_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')))+json_extract(value,'$.beforeHours')/24.0) ORDER BY json_extract(value,'$.beforeHours') DESC LIMIT 1),0) END)>=100
 ON CONFLICT(booking_id,kind) DO UPDATE SET amount=excluded.amount,policy_snapshot_json=excluded.policy_snapshot_json,status='pending',reason=NULL,actor_staff_id=NULL,version=booking_charges.version+1,updated_at=excluded.updated_at
 WHERE booking_charges.status='waived' AND booking_charges.reason='cancellation_reverted'; END;

CREATE TRIGGER booking_cancellation_fee_revert AFTER UPDATE OF status ON bookings WHEN OLD.status IN('cancelled','no_show') AND NEW.status NOT IN('cancelled','no_show')
BEGIN UPDATE booking_charges SET status='waived',reason='cancellation_reverted',version=version+1 WHERE booking_id=NEW.id AND status='pending'; END;
