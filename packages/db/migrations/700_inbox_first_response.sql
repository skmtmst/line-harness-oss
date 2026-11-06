-- G3第1段: 自動割り当ては後段。既定は期限オフ。
CREATE TABLE inbox_routing_settings (
 account_id TEXT PRIMARY KEY REFERENCES line_accounts(id), strategy TEXT NOT NULL DEFAULT 'none' CHECK(strategy='none'),
 sla_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sla_enabled IN (0,1)),
 sla_first_response_minutes INTEGER NOT NULL DEFAULT 30 CHECK(sla_first_response_minutes BETWEEN 5 AND 1440),
 sla_business_hours_only INTEGER NOT NULL DEFAULT 1 CHECK(sla_business_hours_only IN (0,1)),
 notify_before_minutes INTEGER NOT NULL DEFAULT 15, escalate_after_minutes INTEGER NOT NULL DEFAULT 30,
 escalate_team_id TEXT, version INTEGER NOT NULL DEFAULT 1, updated_by TEXT, updated_at TEXT NOT NULL, mutation_token TEXT
);
ALTER TABLE chats ADD COLUMN assigned_by TEXT CHECK(assigned_by IN ('auto','manual'));
ALTER TABLE chats ADD COLUMN pending_since TEXT;
ALTER TABLE chats ADD COLUMN sla_due_at TEXT;
ALTER TABLE chats ADD COLUMN first_response_at TEXT;
ALTER TABLE chats ADD COLUMN sla_notified_stage INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_chats_sla_due ON chats(sla_due_at) WHERE first_response_at IS NULL;
CREATE TRIGGER chats_sla_pending_update AFTER UPDATE OF last_customer_message_at ON chats
WHEN NEW.last_customer_message_at IS NOT NULL AND (OLD.pending_since IS NULL OR OLD.first_response_at IS NOT NULL)
 AND (NEW.last_operator_message_at IS NULL OR julianday(NEW.last_customer_message_at)>julianday(NEW.last_operator_message_at))
BEGIN UPDATE chats SET pending_since=NEW.last_customer_message_at,sla_due_at=NULL,first_response_at=NULL,sla_notified_stage=0 WHERE id=NEW.id; END;
CREATE TRIGGER chats_sla_pending_insert AFTER INSERT ON chats WHEN NEW.last_customer_message_at IS NOT NULL
BEGIN UPDATE chats SET pending_since=NEW.last_customer_message_at WHERE id=NEW.id; END;
CREATE TRIGGER chats_sla_manual_response AFTER UPDATE OF last_operator_message_at ON chats
WHEN NEW.pending_since IS NOT NULL AND NEW.first_response_at IS NULL AND julianday(NEW.last_operator_message_at)>=julianday(NEW.pending_since)
BEGIN UPDATE chats SET first_response_at=NEW.last_operator_message_at,sla_due_at=NULL WHERE id=NEW.id; END;
UPDATE chats SET pending_since=last_customer_message_at WHERE status!='resolved' AND last_customer_message_at IS NOT NULL
 AND (last_operator_message_at IS NULL OR julianday(last_customer_message_at)>julianday(last_operator_message_at));
