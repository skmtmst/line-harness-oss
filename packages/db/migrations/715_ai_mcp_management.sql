-- B-344/B-349 approved 715. No automatic sending is enabled.
CREATE TABLE ai_answer_logs (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),chat_id TEXT,friend_id TEXT,
 question_text TEXT NOT NULL DEFAULT '',action TEXT NOT NULL CHECK(action IN('answered','handed_off','customer_asked_human')),
 handoff_reason TEXT,qa_entry_id TEXT,qa_version INTEGER,answer_snapshot_json TEXT,after_note TEXT,created_at TEXT NOT NULL
);
CREATE INDEX ai_answer_logs_account ON ai_answer_logs(account_id,created_at,id);
CREATE TABLE mcp_connections (
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,
 level TEXT NOT NULL CHECK(level IN('read','draft','send_request')),account_ids_json TEXT NOT NULL CHECK(json_valid(account_ids_json)),
 key_hash TEXT NOT NULL UNIQUE,key_prefix TEXT NOT NULL,previous_key_hash TEXT,previous_key_expires_at TEXT,
 expires_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','stopped')),created_by TEXT NOT NULL,stopped_by TEXT,
 last_used_at TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL
);
CREATE TABLE mcp_call_logs (
 id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES mcp_connections(id),tool TEXT NOT NULL,account_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN('read','draft','send_request','manage')),result TEXT NOT NULL CHECK(result IN('ok','refused','error','rate_limited')),
 refused_reason TEXT,target_type TEXT,target_id TEXT,summary TEXT NOT NULL,at TEXT NOT NULL
);
CREATE INDEX mcp_call_logs_connection ON mcp_call_logs(connection_id,at,id);
