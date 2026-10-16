-- B-344 approved 2026-10-16. Aggregate-only exports, no external storage writes.
CREATE TABLE hq_store_comparison_export_jobs (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),requested_by TEXT NOT NULL REFERENCES staff_members(id),
 request_key TEXT NOT NULL,filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),account_ids_json TEXT NOT NULL CHECK(json_valid(account_ids_json)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','completed','failed')),csv_text TEXT,row_count INTEGER,error_code TEXT,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,completed_at TEXT,UNIQUE(tenant_id,requested_by,request_key)
);
CREATE INDEX hq_store_comparison_exports_due ON hq_store_comparison_export_jobs(status,created_at);
