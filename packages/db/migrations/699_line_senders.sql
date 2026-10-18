-- B-344/B-349: G8 最小。削除はinactive（履歴は保持）。
CREATE TABLE line_senders (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES line_accounts(id), name TEXT NOT NULL,
 icon_media_id TEXT REFERENCES media(id) ON DELETE SET NULL, icon_url TEXT,
 visibility TEXT NOT NULL CHECK(visibility IN ('all','owner_only')),
 owner_staff_id TEXT REFERENCES staff_members(id), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, request_json TEXT NOT NULL, UNIQUE(account_id,idempotency_key),
 CHECK(visibility!='owner_only' OR owner_staff_id IS NOT NULL)
);
CREATE INDEX idx_line_senders_account ON line_senders(account_id,status);
CREATE TRIGGER line_sender_limit BEFORE INSERT ON line_senders
WHEN NEW.status='active' AND (SELECT COUNT(*) FROM line_senders WHERE account_id=NEW.account_id AND status='active')>=20
 AND NOT EXISTS(SELECT 1 FROM line_senders WHERE account_id=NEW.account_id AND idempotency_key=NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT,'sender_limit'); END;
ALTER TABLE messages_log ADD COLUMN sender_id TEXT REFERENCES line_senders(id);
ALTER TABLE messages_log ADD COLUMN sender_snapshot_json TEXT;
ALTER TABLE scheduled_chat_sends ADD COLUMN sender_id TEXT REFERENCES line_senders(id);
ALTER TABLE scheduled_chat_sends ADD COLUMN sender_snapshot_json TEXT;

CREATE TRIGGER line_sender_owner_disabled AFTER UPDATE OF is_active ON staff_members WHEN NEW.is_active=0
BEGIN UPDATE line_senders SET status='inactive',version=version+1 WHERE owner_staff_id=NEW.id AND visibility='owner_only' AND status='active'; END;
