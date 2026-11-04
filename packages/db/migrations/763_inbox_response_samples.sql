-- R5: retain conversation IDs only while the conversation exists.
CREATE TABLE inbox_response_samples (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
 chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
 staff_deleted INTEGER NOT NULL DEFAULT 0 CHECK(staff_deleted IN (0,1)),
 staff_id TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
 reply_kind TEXT NOT NULL DEFAULT 'manual' CHECK(reply_kind IN ('manual','automatic')),
 pending_since TEXT,
 due_at TEXT,
 responded_at TEXT NOT NULL,
 is_first_response INTEGER NOT NULL CHECK(is_first_response IN (0,1))
);
CREATE INDEX inbox_response_samples_period ON inbox_response_samples(account_id,responded_at,staff_id);
CREATE INDEX inbox_response_samples_chat ON inbox_response_samples(chat_id);
CREATE TRIGGER inbox_response_samples_manual AFTER UPDATE OF last_operator_message_at ON chats
WHEN NEW.last_operator_message_at IS NOT NULL
BEGIN
 INSERT INTO inbox_response_samples(id,account_id,chat_id,staff_id,pending_since,due_at,responded_at,is_first_response)
 SELECT lower(hex(randomblob(16))), f.line_account_id, NEW.id, NEW.assignee_staff_id,
   CASE WHEN OLD.pending_since IS NOT NULL AND OLD.first_response_at IS NULL THEN OLD.pending_since ELSE NULL END,
   CASE WHEN OLD.pending_since IS NOT NULL AND OLD.first_response_at IS NULL THEN OLD.sla_due_at ELSE NULL END,
   NEW.last_operator_message_at,
   CASE WHEN OLD.pending_since IS NOT NULL AND OLD.first_response_at IS NULL AND julianday(NEW.last_operator_message_at)>=julianday(OLD.pending_since) THEN 1 ELSE 0 END
 FROM friends f WHERE f.id=NEW.friend_id AND f.line_account_id IS NOT NULL; END;
-- Automatic replies are counted separately and never stop the human SLA clock.
CREATE TRIGGER inbox_response_samples_automatic AFTER INSERT ON messages_log
WHEN NEW.direction='outgoing' AND NEW.source IN ('auto_reply','qa')
BEGIN
 INSERT INTO inbox_response_samples(id,account_id,chat_id,staff_id,reply_kind,pending_since,due_at,responded_at,is_first_response)
 SELECT lower(hex(randomblob(16))),f.line_account_id,(SELECT c.id FROM chats c WHERE c.friend_id=NEW.friend_id LIMIT 1),NULL,'automatic',NULL,NULL,NEW.created_at,0
 FROM friends f WHERE f.id=NEW.friend_id AND f.line_account_id IS NOT NULL; END;

-- Only weekly, anonymous counts survive deletion of a conversation.
CREATE TABLE inbox_response_deleted_weekly (
 account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
 staff_id TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
 staff_deleted INTEGER NOT NULL DEFAULT 0 CHECK(staff_deleted IN (0,1)),
 week TEXT NOT NULL,
 on_time INTEGER NOT NULL DEFAULT 0,
 overdue INTEGER NOT NULL DEFAULT 0,
 no_deadline INTEGER NOT NULL DEFAULT 0,
 automatic INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX inbox_response_deleted_weekly_key ON inbox_response_deleted_weekly(account_id,ifnull(staff_id,''),staff_deleted,week);
CREATE TRIGGER inbox_response_samples_deleted BEFORE DELETE ON inbox_response_samples
WHEN OLD.chat_id IS NOT NULL AND (OLD.reply_kind='automatic' OR (OLD.reply_kind='manual' AND OLD.is_first_response=1))
 AND EXISTS(SELECT 1 FROM line_accounts WHERE id=OLD.account_id)
BEGIN
 INSERT INTO inbox_response_deleted_weekly(account_id,staff_id,staff_deleted,week,on_time,overdue,no_deadline,automatic)
 VALUES(OLD.account_id,OLD.staff_id,OLD.staff_deleted,date(OLD.responded_at,'+09:00','weekday 0','-6 days'),
  CASE WHEN OLD.reply_kind='manual' AND julianday(OLD.responded_at)<=julianday(OLD.due_at) THEN 1 ELSE 0 END,
  CASE WHEN OLD.reply_kind='manual' AND julianday(OLD.responded_at)>julianday(OLD.due_at) THEN 1 ELSE 0 END,
  CASE WHEN OLD.reply_kind='manual' AND OLD.due_at IS NULL THEN 1 ELSE 0 END,
  CASE WHEN OLD.reply_kind='automatic' THEN 1 ELSE 0 END)
 ON CONFLICT DO UPDATE SET on_time=on_time+excluded.on_time,overdue=overdue+excluded.overdue,no_deadline=no_deadline+excluded.no_deadline,automatic=automatic+excluded.automatic; END;
-- Merge deleted staff into one anonymous bucket before their foreign keys are cleared.
CREATE TRIGGER inbox_response_deleted_staff BEFORE DELETE ON staff_members
BEGIN
 UPDATE inbox_response_samples SET staff_deleted=1 WHERE staff_id=OLD.id; INSERT INTO inbox_response_deleted_weekly(account_id,staff_id,staff_deleted,week,on_time,overdue,no_deadline,automatic)
 SELECT account_id,NULL,1,week,SUM(on_time),SUM(overdue),SUM(no_deadline),SUM(automatic) FROM inbox_response_deleted_weekly WHERE staff_id=OLD.id GROUP BY account_id,week
 ON CONFLICT DO UPDATE SET on_time=on_time+excluded.on_time,overdue=overdue+excluded.overdue,no_deadline=no_deadline+excluded.no_deadline,automatic=automatic+excluded.automatic; DELETE FROM inbox_response_deleted_weekly WHERE staff_id=OLD.id; END;
