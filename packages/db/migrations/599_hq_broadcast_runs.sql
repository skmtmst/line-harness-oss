-- 草稿。D1への適用はオーナー承認後。統括の対象店を送信前に固定する。
CREATE TABLE hq_broadcast_runs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), request_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)), status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','scheduled','stopped','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, scheduled_at TEXT, dispatch_token TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(tenant_id,request_id)
);
CREATE TABLE hq_broadcast_targets (
 run_id TEXT NOT NULL REFERENCES hq_broadcast_runs(id), line_account_id TEXT NOT NULL,
 account_name TEXT NOT NULL, tag_id TEXT, excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),
 broadcast_id TEXT UNIQUE, preflight_json TEXT CHECK(preflight_json IS NULL OR json_valid(preflight_json)),
 PRIMARY KEY(run_id,line_account_id)
);
CREATE TABLE hq_broadcast_audit (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES hq_broadcast_runs(id), line_account_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
ALTER TABLE broadcasts ADD COLUMN hq_run_id TEXT REFERENCES hq_broadcast_runs(id);
CREATE INDEX broadcasts_hq_run ON broadcasts(hq_run_id);
