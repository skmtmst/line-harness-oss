-- B-344 approved 2026-10-16. Purpose and simulation survive drafts and scheduled jobs.
CREATE TABLE broadcast_execution_contexts (
 broadcast_id TEXT PRIMARY KEY REFERENCES broadcasts(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES line_accounts(id),
 purpose TEXT NOT NULL CHECK(purpose IN('transaction','notice','marketing')),execution_mode TEXT NOT NULL DEFAULT 'simulation' CHECK(execution_mode='simulation'),
 created_via TEXT NOT NULL CHECK(created_via IN('manual','mcp')),created_by TEXT NOT NULL,mcp_connection_id TEXT REFERENCES mcp_connections(id),
 request_key TEXT NOT NULL,request_fingerprint TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN('draft','scheduled','completed')),
 execution_key TEXT,execution_request_json TEXT,confirmed_count INTEGER,completed_at TEXT,
 UNIQUE(account_id,created_by,request_key)
);
INSERT INTO broadcast_execution_contexts(broadcast_id,account_id,purpose,created_via,created_by,mcp_connection_id,request_key,request_fingerprint)
SELECT DISTINCT b.id,b.line_account_id,'marketing','mcp',m.created_by,m.id,'legacy:'||b.id,'legacy' FROM broadcasts b JOIN mcp_call_logs l ON l.target_id=b.id AND l.tool='create_broadcast_draft' AND l.result='ok' JOIN mcp_connections m ON m.id=l.connection_id;
-- A simulated recipient can never be claimed by a real transport, including retries.
CREATE TRIGGER broadcast_simulation_dispatch_insert BEFORE INSERT ON broadcast_send_claims
WHEN (NEW.dispatched_at IS NOT NULL OR NEW.state='sent') AND EXISTS(SELECT 1 FROM broadcast_execution_contexts WHERE broadcast_id=NEW.broadcast_id)
BEGIN SELECT RAISE(ABORT,'simulation_transport_forbidden'); END;
CREATE TRIGGER broadcast_simulation_dispatch_update BEFORE UPDATE ON broadcast_send_claims
WHEN (NEW.dispatched_at IS NOT NULL OR NEW.state='sent') AND EXISTS(SELECT 1 FROM broadcast_execution_contexts WHERE broadcast_id=NEW.broadcast_id)
BEGIN SELECT RAISE(ABORT,'simulation_transport_forbidden'); END;

-- B-354: account opt-in and durable acknowledgement; defaults never enable AI.
CREATE TABLE account_ai_features (
 account_id TEXT NOT NULL REFERENCES line_accounts(id),feature TEXT NOT NULL CHECK(feature IN('banner','google_review')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),version INTEGER NOT NULL DEFAULT 1,
 consent_by TEXT,consent_at TEXT,disclosure_version TEXT,
 CHECK(enabled=0 OR (consent_by IS NOT NULL AND consent_at IS NOT NULL AND disclosure_version IS NOT NULL)),
 PRIMARY KEY(account_id,feature)
);
ALTER TABLE banner_generations ADD COLUMN ai_account_id TEXT REFERENCES line_accounts(id);
