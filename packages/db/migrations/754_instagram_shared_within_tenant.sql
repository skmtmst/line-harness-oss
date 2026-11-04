-- 同じ統括の複数 LINE アカウントで Instagram を共有する。
-- 既存の接続・受信履歴を保持し、別統括への共有は DB 側でも拒否する。
CREATE TABLE instagram_connections_shared (
 line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id), page_id TEXT NOT NULL,
 instagram_id TEXT NOT NULL, page_name TEXT NOT NULL, username TEXT,
 page_token_encrypted TEXT NOT NULL, user_token_encrypted TEXT NOT NULL,
 expires_at TEXT NOT NULL, data_access_expires_at TEXT, profile_json TEXT, posts_json TEXT,
 refreshed_at TEXT NOT NULL, synced_at TEXT, connected_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, scopes TEXT NOT NULL DEFAULT ''
);
INSERT INTO instagram_connections_shared SELECT line_account_id,page_id,instagram_id,page_name,username,page_token_encrypted,user_token_encrypted,expires_at,data_access_expires_at,profile_json,posts_json,refreshed_at,synced_at,connected_by,version,scopes FROM instagram_connections;
DROP TABLE instagram_connections;
ALTER TABLE instagram_connections_shared RENAME TO instagram_connections;
CREATE INDEX idx_instagram_connections_instagram_id ON instagram_connections(instagram_id);
CREATE TRIGGER instagram_connection_tenant_insert BEFORE INSERT ON instagram_connections WHEN EXISTS(SELECT 1 FROM instagram_connections existing JOIN line_accounts old_account ON old_account.id=existing.line_account_id JOIN line_accounts new_account ON new_account.id=NEW.line_account_id WHERE existing.instagram_id=NEW.instagram_id AND existing.line_account_id<>NEW.line_account_id AND COALESCE(old_account.tenant_id,'00000000-0000-4000-8000-000000000001')<>COALESCE(new_account.tenant_id,'00000000-0000-4000-8000-000000000001')) BEGIN SELECT RAISE(ABORT,'instagram_cross_tenant'); END;
CREATE TRIGGER instagram_connection_tenant_update BEFORE UPDATE OF instagram_id,line_account_id ON instagram_connections WHEN EXISTS(SELECT 1 FROM instagram_connections existing JOIN line_accounts old_account ON old_account.id=existing.line_account_id JOIN line_accounts new_account ON new_account.id=NEW.line_account_id WHERE existing.instagram_id=NEW.instagram_id AND existing.line_account_id<>NEW.line_account_id AND COALESCE(old_account.tenant_id,'00000000-0000-4000-8000-000000000001')<>COALESCE(new_account.tenant_id,'00000000-0000-4000-8000-000000000001')) BEGIN SELECT RAISE(ABORT,'instagram_cross_tenant'); END;

-- Meta のメッセージ ID は共有先すべてで同じため、所属アカウントと組にする。
CREATE TABLE instagram_messages_shared (
 id TEXT NOT NULL, line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
 instagram_id TEXT NOT NULL, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
 content TEXT NOT NULL, attachments_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attachments_json)), received_at TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(line_account_id,id)
);
INSERT INTO instagram_messages_shared SELECT id,line_account_id,instagram_id,sender_id,recipient_id,content,attachments_json,received_at,created_at FROM instagram_messages;
DROP TABLE instagram_messages;
ALTER TABLE instagram_messages_shared RENAME TO instagram_messages;
CREATE INDEX idx_instagram_messages_account_time ON instagram_messages(line_account_id,received_at,id);
