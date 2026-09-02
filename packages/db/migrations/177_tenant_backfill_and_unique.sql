-- 指示B以後に作られたNULL行も、既定の統括へ安全に補完する。
UPDATE line_accounts
SET tenant_id = '00000000-0000-4000-8000-000000000001'
WHERE tenant_id IS NULL;

UPDATE staff_members
SET tenant_id = '00000000-0000-4000-8000-000000000001'
WHERE tenant_id IS NULL;

UPDATE rt_organizations
SET tenant_id = '00000000-0000-4000-8000-000000000001'
WHERE tenant_id IS NULL;

-- 1統括につき飲食店組織は1つ。既存の非一意インデックスは残してよい。
CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_organizations_tenant_unique
  ON rt_organizations(tenant_id);
