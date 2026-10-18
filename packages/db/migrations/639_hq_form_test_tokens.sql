-- Owner-approved: HQ previews pin an immutable version and never store answers.
CREATE TABLE hq_form_test_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_members(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(template_id,tenant_id) REFERENCES hq_templates(id,tenant_id),
  FOREIGN KEY(template_version_id,template_id,tenant_id) REFERENCES hq_template_versions(id,template_id,tenant_id)
);
CREATE INDEX idx_hq_form_test_tokens_active ON hq_form_test_tokens(tenant_id,template_id,expires_at);
