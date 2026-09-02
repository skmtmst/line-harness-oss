-- 統括（テナント）。1つの企業＝1行。
-- LINE公式アカウントを持たない単位として存在できることが目的。
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 既定の統括。既存データはすべてここに属する扱いにして、挙動を変えない。
INSERT OR IGNORE INTO tenants (id, name) VALUES
  ('00000000-0000-4000-8000-000000000001', '既定の統括');

ALTER TABLE line_accounts ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE staff_members ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE rt_organizations ADD COLUMN tenant_id TEXT REFERENCES tenants(id);

UPDATE line_accounts
SET tenant_id = '00000000-0000-4000-8000-000000000001'
WHERE tenant_id IS NULL;
UPDATE staff_members
SET tenant_id = '00000000-0000-4000-8000-000000000001'
WHERE tenant_id IS NULL;
UPDATE rt_organizations
SET tenant_id = '00000000-0000-4000-8000-000000000001'
WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_line_accounts_tenant
  ON line_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_tenant
  ON staff_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rt_organizations_tenant
  ON rt_organizations(tenant_id);
