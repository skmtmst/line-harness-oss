-- 利用規約への同意記録。統括（組織）単位で1バージョンにつき1件。
CREATE TABLE IF NOT EXISTS rt_organization_agreements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
  document_key TEXT NOT NULL,
  document_version TEXT NOT NULL,
  agreed_by_staff_id TEXT,
  agreed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, document_key, document_version)
);
CREATE INDEX IF NOT EXISTS idx_rt_org_agreements_org
  ON rt_organization_agreements(organization_id, document_key);
