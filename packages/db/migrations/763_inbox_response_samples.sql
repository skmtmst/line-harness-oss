-- R5: record each manual reply prospectively without customer or conversation IDs.
CREATE TABLE inbox_response_samples (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES line_accounts(id),
 staff_id TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
 reply_kind TEXT NOT NULL DEFAULT 'manual' CHECK(reply_kind IN ('manual','automatic')),
 pending_since TEXT,
 due_at TEXT,
 responded_at TEXT NOT NULL,
 is_first_response INTEGER NOT NULL CHECK(is_first_response IN (0,1))
);
CREATE INDEX inbox_response_samples_period ON inbox_response_samples(account_id,responded_at,staff_id);
CREATE TRIGGER inbox_response_samples_manual AFTER UPDATE OF last_operator_message_at ON chats
WHEN NEW.last_operator_message_at IS NOT NULL
BEGIN
 INSERT INTO inbox_response_samples(id,account_id,staff_id,pending_since,due_at,responded_at,is_first_response)
 SELECT lower(hex(randomblob(16))), f.line_account_id, NEW.assignee_staff_id,
   CASE WHEN OLD.pending_since IS NOT NULL AND OLD.first_response_at IS NULL THEN OLD.pending_since ELSE NULL END,
   CASE WHEN OLD.pending_since IS NOT NULL AND OLD.first_response_at IS NULL THEN OLD.sla_due_at ELSE NULL END,
   NEW.last_operator_message_at,
   CASE WHEN OLD.pending_since IS NOT NULL AND OLD.first_response_at IS NULL AND julianday(NEW.last_operator_message_at)>=julianday(OLD.pending_since) THEN 1 ELSE 0 END
 FROM friends f WHERE f.id=NEW.friend_id AND f.line_account_id IS NOT NULL; END;
-- Automatic replies are counted separately and never stop the human SLA clock.
CREATE TRIGGER inbox_response_samples_automatic AFTER INSERT ON messages_log
WHEN NEW.direction='outgoing' AND NEW.source IN ('auto_reply','qa')
BEGIN
 INSERT INTO inbox_response_samples(id,account_id,staff_id,reply_kind,pending_since,due_at,responded_at,is_first_response)
 SELECT lower(hex(randomblob(16))),f.line_account_id,NULL,'automatic',NULL,NULL,NEW.created_at,0
 FROM friends f WHERE f.id=NEW.friend_id AND f.line_account_id IS NOT NULL; END;
