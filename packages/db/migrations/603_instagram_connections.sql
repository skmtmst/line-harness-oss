-- 草稿。D1への適用にはオーナー承認が必要。
CREATE TABLE instagram_oauth_states (
 state_hash TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
 staff_id TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('started','exchanging','selecting','connecting')),
 candidates_encrypted TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE instagram_connections (
 line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id), page_id TEXT NOT NULL,
 instagram_id TEXT NOT NULL UNIQUE, page_name TEXT NOT NULL, username TEXT,
 page_token_encrypted TEXT NOT NULL, user_token_encrypted TEXT NOT NULL,
 expires_at TEXT NOT NULL, data_access_expires_at TEXT, profile_json TEXT, posts_json TEXT,
 refreshed_at TEXT NOT NULL, synced_at TEXT, connected_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE instagram_messages (
 id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
 instagram_id TEXT NOT NULL, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
 content TEXT NOT NULL, attachments_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attachments_json)), received_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(line_account_id,id)
);
CREATE INDEX idx_instagram_messages_account_time ON instagram_messages(line_account_id,received_at,id);
