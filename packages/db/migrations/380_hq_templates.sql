CREATE TABLE hq_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('tag', 'template', 'rich_menu', 'form')),
  name TEXT NOT NULL,
  description TEXT,
  current_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, tenant_id)
);

CREATE TABLE hq_template_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  definition_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (template_id, version),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (template_id, tenant_id)
    REFERENCES hq_templates(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE hq_template_preflights (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  distribution_mode TEXT NOT NULL CHECK (distribution_mode IN ('create', 'overwrite', 'alias')),
  snapshot_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'blocked', 'expired')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  UNIQUE (template_version_id, target_account_id, distribution_mode, snapshot_token),
  FOREIGN KEY (template_id, tenant_id)
    REFERENCES hq_templates(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (template_version_id, tenant_id)
    REFERENCES hq_template_versions(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE hq_template_distribution_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  preflight_id TEXT,
  distribution_mode TEXT NOT NULL CHECK (distribution_mode IN ('create', 'overwrite', 'alias')),
  idempotency_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  UNIQUE (tenant_id, idempotency_fingerprint),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (template_id, tenant_id)
    REFERENCES hq_templates(id, tenant_id),
  FOREIGN KEY (template_version_id, tenant_id)
    REFERENCES hq_template_versions(id, tenant_id),
  FOREIGN KEY (preflight_id) REFERENCES hq_template_preflights(id)
);

CREATE TABLE hq_template_distribution_results (
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  snapshot_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'staged', 'succeeded', 'failed', 'version_conflict', 'unsupported')),
  error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  PRIMARY KEY (run_id, target_account_id),
  UNIQUE (tenant_id, target_account_id, idempotency_fingerprint),
  FOREIGN KEY (run_id, tenant_id)
    REFERENCES hq_template_distribution_runs(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE hq_template_owned_r2_keys (
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  owner_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('staged', 'committed', 'cleanup_pending', 'cleaned', 'reconciled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (run_id, target_account_id, object_key),
  FOREIGN KEY (run_id, tenant_id)
    REFERENCES hq_template_distribution_runs(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX idx_hq_templates_tenant_type
  ON hq_templates(tenant_id, template_type, updated_at);
CREATE INDEX idx_hq_template_versions_template
  ON hq_template_versions(template_id, version DESC);
CREATE INDEX idx_hq_template_preflights_target
  ON hq_template_preflights(tenant_id, target_account_id, created_at);
CREATE INDEX idx_hq_template_runs_template
  ON hq_template_distribution_runs(tenant_id, template_id, created_at);
CREATE INDEX idx_hq_template_results_status
  ON hq_template_distribution_results(run_id, status);
CREATE INDEX idx_hq_template_owned_r2_reconcile
  ON hq_template_owned_r2_keys(state, updated_at);
