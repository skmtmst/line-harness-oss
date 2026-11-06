-- B-344/B-349 approved 714. Existing SLA strategy constraint remains intact.
CREATE TABLE inbox_assignment_settings (
 account_id TEXT PRIMARY KEY REFERENCES line_accounts(id),
 strategy TEXT NOT NULL DEFAULT 'none' CHECK(strategy IN('none','even','priority','random_weighted')),
 targets_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(targets_json))
);
CREATE TABLE staff_presence (
 staff_id TEXT PRIMARY KEY REFERENCES staff_members(id), away INTEGER NOT NULL DEFAULT 0 CHECK(away IN(0,1)), last_seen_at TEXT NOT NULL
);
CREATE TABLE inbox_assignment_logs (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES line_accounts(id),chat_id TEXT NOT NULL REFERENCES chats(id),
 staff_id TEXT NOT NULL REFERENCES staff_members(id),strategy TEXT NOT NULL,decided_at TEXT NOT NULL,mutation_token TEXT NOT NULL UNIQUE
);
CREATE INDEX inbox_assignment_recent ON inbox_assignment_logs(account_id,staff_id,decided_at);
ALTER TABLE chats ADD COLUMN assignment_token TEXT;
ALTER TABLE chats ADD COLUMN assigned_at TEXT;
