-- B-344/B-349 approved 720. Manual/offline plans only; no live checkout.
CREATE TABLE booking_pass_plans (
 id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id),kind TEXT NOT NULL CHECK(kind IN('ticket','monthly')),name TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price>=0),count INTEGER,monthly_limit INTEGER,valid_days INTEGER NOT NULL CHECK(valid_days BETWEEN 1 AND 3650),
 target_scope_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(target_scope_json)),allow_without_pass INTEGER NOT NULL DEFAULT 1 CHECK(allow_without_pass IN(0,1)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','on_sale','stopped')),version INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_json TEXT NOT NULL,
 UNIQUE(line_account_id,created_by,idempotency_key),CHECK(kind='ticket' AND count>0 AND monthly_limit IS NULL OR kind='monthly' AND count IS NULL AND monthly_limit>0)
);
ALTER TABLE booking_entitlements ADD COLUMN plan_id TEXT REFERENCES booking_pass_plans(id);
ALTER TABLE booking_entitlements ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN('manual','online'));
ALTER TABLE booking_entitlements ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'ok' CHECK(billing_status IN('ok','grace','stopped'));
ALTER TABLE booking_entitlement_uses ADD COLUMN returned_at TEXT;
CREATE TRIGGER pass_plan_selection BEFORE INSERT ON booking_entitlement_uses
WHEN EXISTS(SELECT 1 FROM booking_entitlements e JOIN bookings b ON b.id=NEW.booking_id JOIN booking_pass_plans p ON p.id=e.plan_id WHERE e.id=NEW.entitlement_id AND (e.billing_status='stopped' OR p.line_account_id<>b.line_account_id OR json_array_length(p.target_scope_json)>0 AND NOT EXISTS(SELECT 1 FROM json_each(p.target_scope_json) WHERE value=b.menu_id)))
BEGIN SELECT RAISE(ABORT,'entitlement_unavailable'); END;
CREATE TRIGGER pass_plan_reschedule BEFORE UPDATE OF menu_id ON bookings
WHEN EXISTS(SELECT 1 FROM booking_entitlement_uses u JOIN booking_entitlements e ON e.id=u.entitlement_id JOIN booking_pass_plans p ON p.id=e.plan_id WHERE u.booking_id=NEW.id AND json_array_length(p.target_scope_json)>0 AND NOT EXISTS(SELECT 1 FROM json_each(p.target_scope_json) WHERE value=NEW.menu_id))
BEGIN SELECT RAISE(ABORT,'entitlement_unavailable'); END;
CREATE TRIGGER pass_plan_cancel_return AFTER UPDATE OF status ON bookings WHEN NEW.status='cancelled' AND OLD.status='confirmed' AND EXISTS(SELECT 1 FROM booking_entitlement_uses WHERE booking_id=NEW.id AND consumed_at IS NOT NULL AND returned_at IS NULL)  AND julianday(NEW.starts_at)>=julianday(COALESCE(NEW.cancelled_at,NEW.decided_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')))+COALESCE((SELECT m.cancel_deadline_hours_before/24.0 FROM menus m WHERE m.id=NEW.menu_id),(SELECT s.cancel_deadline_minutes_before/1440.0 FROM booking_settings s WHERE s.line_account_id=NEW.line_account_id),1) BEGIN  UPDATE booking_entitlements SET remaining=CASE WHEN kind='ticket' THEN remaining+1 ELSE NULL END,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=(SELECT entitlement_id FROM booking_entitlement_uses WHERE booking_id=NEW.id AND returned_at IS NULL);  INSERT INTO booking_entitlement_events(id,entitlement_id,line_account_id,action,reason,actor_type,actor_id,request_key,request_json,after_json,created_at)  SELECT lower(hex(randomblob(16))),e.id,e.line_account_id,'adjust','取消で戻した','system',NEW.id,'cancel-return:'||NEW.id,json_object('bookingId',NEW.id),json_object('remaining',e.remaining,'version',e.version),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM booking_entitlements e JOIN booking_entitlement_uses u ON u.entitlement_id=e.id WHERE u.booking_id=NEW.id AND u.returned_at IS NULL;  UPDATE booking_entitlement_uses SET returned_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE booking_id=NEW.id AND returned_at IS NULL; END;
CREATE TRIGGER pass_plan_cancelled_reconfirm BEFORE UPDATE OF status ON bookings
WHEN NEW.status='confirmed' AND OLD.status='cancelled' AND EXISTS(SELECT 1 FROM booking_entitlement_uses WHERE booking_id=NEW.id AND returned_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'entitlement_cancelled_retry'); END;

DROP TRIGGER booking_entitlement_consume_guard;
CREATE TRIGGER booking_entitlement_consume_guard BEFORE UPDATE OF consumed_at ON booking_entitlement_uses
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM booking_entitlements e JOIN bookings b ON b.id=NEW.booking_id WHERE e.id=NEW.entitlement_id AND b.line_account_id=e.line_account_id AND b.friend_id=e.friend_id AND (e.menu_id IS NULL OR e.menu_id=b.menu_id) AND e.status='active' AND julianday(b.starts_at)>=julianday(e.valid_from) AND julianday(b.starts_at)<julianday(e.expires_at) AND (e.kind='ticket' AND e.remaining>0 OR e.kind='monthly' AND julianday(b.starts_at)>=julianday(NEW.period_start) AND julianday(b.starts_at)<julianday(NEW.period_end) AND (SELECT COUNT(*) FROM booking_entitlement_uses u JOIN bookings other ON other.id=u.booking_id WHERE u.entitlement_id=e.id AND u.consumed_at IS NOT NULL AND u.returned_at IS NULL AND julianday(other.starts_at)>=julianday(NEW.period_start) AND julianday(other.starts_at)<julianday(NEW.period_end))<COALESCE((SELECT allowance FROM booking_entitlement_month_limits ml WHERE ml.entitlement_id=e.id AND ml.period_start=NEW.period_start),e.monthly_limit))) THEN RAISE(ABORT,'entitlement_unavailable') END; END;

CREATE TRIGGER pass_plan_consume BEFORE UPDATE OF consumed_at ON booking_entitlement_uses
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND EXISTS(SELECT 1 FROM booking_entitlements e JOIN bookings b ON b.id=NEW.booking_id JOIN booking_pass_plans p ON p.id=e.plan_id WHERE e.id=NEW.entitlement_id AND (e.billing_status='stopped' OR json_array_length(p.target_scope_json)>0 AND NOT EXISTS(SELECT 1 FROM json_each(p.target_scope_json) WHERE value=b.menu_id)))
BEGIN SELECT RAISE(ABORT,'entitlement_unavailable'); END;
