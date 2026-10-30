-- 統括の承認した組と配布の実行を結び、結果不明の再試行で二重に作らない。
CREATE TABLE style_starter_catalog_items (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  template_id TEXT NOT NULL REFERENCES hq_templates(id),
  template_version_id TEXT NOT NULL REFERENCES hq_template_versions(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  set_id TEXT NOT NULL REFERENCES style_starter_sets(id),
  set_version INTEGER NOT NULL CHECK(set_version > 0),
  style TEXT NOT NULL CHECK(style IN ('standard','ec','restaurant','salon','consult','lesson')),
  kind TEXT NOT NULL CHECK(kind IN ('rich_menu','template','tag','auto_reply','coupon','form')),
  initiated_by TEXT NOT NULL REFERENCES staff_members(id),
  approved_by TEXT NOT NULL REFERENCES staff_members(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','succeeded','blocked','failed')),
  distribution_run_id TEXT,
  error_code TEXT,
  lease_token TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(line_account_id,template_id)
);
CREATE INDEX idx_starter_catalog_tenant_account ON style_starter_catalog_items(tenant_id,line_account_id);
CREATE TABLE style_starter_catalog_resources (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  resource_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(line_account_id,resource_kind,target_id)
);
ALTER TABLE hq_template_preflights ADD COLUMN initial_insert INTEGER NOT NULL DEFAULT 0 CHECK(initial_insert IN (0,1));
