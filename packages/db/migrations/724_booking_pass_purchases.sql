-- B-344 approved 2026-10-16. No live payment can be recorded in this tranche.
ALTER TABLE booking_entitlements ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE booking_entitlements ADD COLUMN grace_until TEXT;
CREATE UNIQUE INDEX booking_pass_subscription ON booking_entitlements(line_account_id,stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE TABLE booking_pass_purchases (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),plan_id TEXT NOT NULL REFERENCES booking_pass_plans(id),
 amount INTEGER NOT NULL CHECK(amount>=0),snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),request_key TEXT NOT NULL,checkout_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','paid')),entitlement_id TEXT REFERENCES booking_entitlements(id),subscription_id TEXT UNIQUE,
 test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),created_at TEXT NOT NULL,paid_at TEXT,UNIQUE(account_id,friend_id,request_key)
);
CREATE TABLE booking_pass_billing_events (
 event_id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES booking_pass_purchases(id),subscription_id TEXT,invoice_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN('checkout.session.completed','invoice.paid','invoice.payment_failed','customer.subscription.deleted')),
 period_start TEXT NOT NULL,period_end TEXT NOT NULL,occurred_at TEXT NOT NULL,request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 result TEXT NOT NULL CHECK(result IN('recorded','applied','ignored')),test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1)
);
CREATE INDEX booking_pass_billing_cycle ON booking_pass_billing_events(subscription_id,period_start,occurred_at);
CREATE TRIGGER booking_pass_grace_selection BEFORE INSERT ON booking_entitlement_uses
WHEN EXISTS(SELECT 1 FROM booking_entitlements e WHERE e.id=NEW.entitlement_id AND e.billing_status='grace' AND julianday(e.grace_until)<=julianday('now'))
BEGIN SELECT RAISE(ABORT,'entitlement_unavailable'); END;
CREATE TRIGGER booking_pass_grace_consumption BEFORE UPDATE OF consumed_at ON booking_entitlement_uses
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND EXISTS(SELECT 1 FROM booking_entitlements e WHERE e.id=NEW.entitlement_id AND e.billing_status='grace' AND julianday(e.grace_until)<=julianday('now'))
BEGIN SELECT RAISE(ABORT,'entitlement_unavailable'); END;

-- B2-18/19: owner-approved follow-up within 724; all notices are simulations.
ALTER TABLE booking_pass_plans ADD COLUMN notify_remaining_one INTEGER NOT NULL DEFAULT 0 CHECK(notify_remaining_one IN(0,1));
ALTER TABLE booking_pass_plans ADD COLUMN notify_expiry_14_days INTEGER NOT NULL DEFAULT 0 CHECK(notify_expiry_14_days IN(0,1));
CREATE TABLE booking_entitlement_notices (
 id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),
 entitlement_id TEXT NOT NULL REFERENCES booking_entitlements(id),plan_id TEXT NOT NULL REFERENCES booking_pass_plans(id),
 kind TEXT NOT NULL CHECK(kind IN('remaining_one','expiry_14_days')),dedupe_key TEXT NOT NULL,
 purpose TEXT NOT NULL DEFAULT 'transaction' CHECK(purpose='transaction'),messages_json TEXT NOT NULL CHECK(json_valid(messages_json)),
 scheduled_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','simulated','skipped_disabled','skipped_unavailable','skipped_opted_out','skipped_late')),
 processed_at TEXT,test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),UNIQUE(entitlement_id,kind,dedupe_key)
);
CREATE INDEX booking_entitlement_notices_due ON booking_entitlement_notices(status,scheduled_at);
CREATE TRIGGER booking_pass_remaining_notice AFTER INSERT ON booking_entitlement_events
WHEN NEW.action='consume'
BEGIN  INSERT INTO booking_entitlement_notices(id,line_account_id,friend_id,entitlement_id,plan_id,kind,dedupe_key,messages_json,scheduled_at) SELECT lower(hex(randomblob(16))),e.line_account_id,e.friend_id,e.id,e.plan_id,'remaining_one','once',json_array(json_object('type','text','text',e.name||'の残りは1回です（期限 '||e.expires_at||'）')),NEW.created_at FROM booking_entitlements e JOIN booking_pass_plans p ON p.id=e.plan_id AND p.line_account_id=e.line_account_id WHERE e.id=NEW.entitlement_id AND e.kind='ticket' AND e.remaining=1 AND e.status='active' AND e.friend_id IS NOT NULL AND p.notify_remaining_one=1 ON CONFLICT(entitlement_id,kind,dedupe_key) DO NOTHING; END;
