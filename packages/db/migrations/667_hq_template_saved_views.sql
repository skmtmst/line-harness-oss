-- B-324: API組5、番号667承認済み。DB適用は司令塔の別工程。
CREATE TABLE hq_template_saved_views (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_staff_id TEXT NOT NULL REFERENCES staff_members(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),
  scope TEXT NOT NULL CHECK(scope IN ('personal','tenant')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_hq_template_saved_views_scope ON hq_template_saved_views(tenant_id,scope,owner_staff_id,archived_at);
