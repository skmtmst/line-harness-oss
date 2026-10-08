-- 統括の一括配信の分類と、店と同じ二者承認。
CREATE TABLE hq_broadcast_folders (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, archived_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_hq_broadcast_folder_name ON hq_broadcast_folders(tenant_id,name) WHERE archived_at IS NULL;
ALTER TABLE hq_broadcast_runs ADD COLUMN approval_json TEXT CHECK(approval_json IS NULL OR json_valid(approval_json));
