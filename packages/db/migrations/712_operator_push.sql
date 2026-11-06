CREATE TABLE operator_push_subscriptions(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES staff_members(id),endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,user_agent_label TEXT NOT NULL,created_at TEXT NOT NULL,last_success_at TEXT,last_error_code TEXT,revoked_at TEXT);
CREATE TABLE operator_push_preferences(staff_id TEXT PRIMARY KEY REFERENCES staff_members(id),kinds_json TEXT NOT NULL DEFAULT '["new_inquiry","assigned_reply"]' CHECK(json_valid(kinds_json)),quiet_start TEXT NOT NULL DEFAULT '22:00',quiet_end TEXT NOT NULL DEFAULT '08:00',quiet_allow_critical INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE operator_push_deliveries(id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES operator_push_subscriptions(id),kind TEXT NOT NULL,ref_id TEXT NOT NULL,line_account_id TEXT REFERENCES line_accounts(id),status TEXT NOT NULL CHECK(status IN('pending','sent','failed','gone','suppressed_quiet','batched')),error_code TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT,created_at TEXT NOT NULL,UNIQUE(subscription_id,kind,ref_id));
CREATE TRIGGER operator_push_revoke_staff AFTER UPDATE OF is_active,role,password_hash,permission_keys,view_permission_keys,account_scope,assigned_line_account_id ON staff_members
BEGIN UPDATE operator_push_subscriptions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE staff_id=NEW.id AND revoked_at IS NULL; END;
CREATE TRIGGER operator_push_logout AFTER DELETE ON admin_sessions
BEGIN UPDATE operator_push_subscriptions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE staff_id=OLD.staff_id AND revoked_at IS NULL; END;

CREATE TRIGGER operator_push_scope_insert AFTER INSERT ON staff_account_scopes
BEGIN UPDATE operator_push_subscriptions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE staff_id=NEW.staff_id AND revoked_at IS NULL; END;
CREATE TRIGGER operator_push_scope_delete AFTER DELETE ON staff_account_scopes
BEGIN UPDATE operator_push_subscriptions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE staff_id=OLD.staff_id AND revoked_at IS NULL; END;
