-- B-344/B-349 approved 719. Simulation-only ledger; no live delivery.
CREATE TABLE ec_behavior_events (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT REFERENCES friends(id),ec_customer_id TEXT,
 type TEXT NOT NULL CHECK(type IN('cart_add','cart_remove','product_view','purchase','restock','restock_subscribe')),
 product_id TEXT NOT NULL,product_snapshot_json TEXT NOT NULL CHECK(json_valid(product_snapshot_json)),occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,dedupe_key TEXT NOT NULL,
 UNIQUE(account_id,dedupe_key)
);
CREATE INDEX ec_behavior_friend ON ec_behavior_events(account_id,friend_id,occurred_at,type);
CREATE TABLE ec_auto_line_rules (
 account_id TEXT NOT NULL REFERENCES line_accounts(id),kind TEXT NOT NULL CHECK(kind IN('cart','browse','restock')),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 wait_minutes INTEGER NOT NULL,messages_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(messages_json)),version INTEGER NOT NULL DEFAULT 1,test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),updated_by TEXT,PRIMARY KEY(account_id,kind)
);
CREATE TABLE ec_auto_line_sends (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),rule_kind TEXT NOT NULL,friend_id TEXT NOT NULL REFERENCES friends(id),product_id TEXT NOT NULL,
 trigger_event_id TEXT NOT NULL REFERENCES ec_behavior_events(id),scheduled_at TEXT NOT NULL,original_due_at TEXT NOT NULL,messages_snapshot_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',
 sent_at TEXT,test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),claim_token TEXT,UNIQUE(trigger_event_id,rule_kind)
);
CREATE INDEX ec_auto_line_sends_due ON ec_auto_line_sends(status,scheduled_at);
CREATE INDEX ec_auto_line_sends_caps ON ec_auto_line_sends(account_id,friend_id,sent_at,product_id);
CREATE TABLE ec_auto_line_rule_events (
 account_id TEXT NOT NULL REFERENCES line_accounts(id),request_key TEXT NOT NULL,kind TEXT NOT NULL,
 actor_id TEXT NOT NULL,impersonation_id TEXT,reason TEXT,request_json TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(account_id,request_key)
);
