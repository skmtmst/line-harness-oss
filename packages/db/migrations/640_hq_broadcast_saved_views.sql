-- Owner-approved: shared HQ searches and private searches stay separate from stores.
CREATE TABLE hq_broadcast_saved_views (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  staff_id TEXT NOT NULL REFERENCES staff_members(id),
  scope TEXT NOT NULL DEFAULT 'hq' CHECK(scope IN ('private','hq')),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json) AND json_type(conditions_json)='object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
);
CREATE INDEX idx_hq_broadcast_saved_views_visible ON hq_broadcast_saved_views(tenant_id,scope,staff_id,archived_at,updated_at);
CREATE UNIQUE INDEX idx_hq_broadcast_saved_views_name ON hq_broadcast_saved_views(tenant_id,staff_id,scope,name) WHERE archived_at IS NULL;
