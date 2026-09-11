CREATE TABLE hq_templates (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('tag', 'template', 'rich_menu', 'form')),
  name TEXT NOT NULL,
  description TEXT,
  current_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  PRIMARY KEY (id, tenant_id),
  FOREIGN KEY (current_version_id, id, tenant_id)
    REFERENCES hq_template_versions(id, template_id, tenant_id)
);

CREATE TABLE hq_template_versions (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  definition_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id, tenant_id),
  UNIQUE (template_id, tenant_id, version),
  UNIQUE (id, template_id, tenant_id),
  FOREIGN KEY (template_id, tenant_id)
    REFERENCES hq_templates(id, tenant_id)
);

CREATE TABLE hq_template_preflights (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  distribution_mode TEXT NOT NULL CHECK (distribution_mode IN ('create', 'overwrite', 'alias')),
  idempotency_fingerprint TEXT NOT NULL,
  snapshot_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'blocked', 'expired', 'consumed')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  PRIMARY KEY (id, tenant_id),
  UNIQUE (tenant_id, target_account_id, idempotency_fingerprint),
  UNIQUE (id, tenant_id, template_id, template_version_id, target_account_id, snapshot_token),
  FOREIGN KEY (template_id, tenant_id)
    REFERENCES hq_templates(id, tenant_id),
  FOREIGN KEY (template_version_id, template_id, tenant_id)
    REFERENCES hq_template_versions(id, template_id, tenant_id)
);

CREATE TABLE hq_template_preflight_resolutions (
  preflight_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  snapshot_token TEXT NOT NULL,
  source_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  resolution_mode TEXT NOT NULL CHECK (resolution_mode IN ('create', 'overwrite', 'alias')),
  target_id TEXT,
  alias_name TEXT,
  expected_revision TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (preflight_id, tenant_id, source_id),
  CHECK (resolution_mode != 'overwrite' OR (target_id IS NOT NULL AND expected_revision IS NOT NULL)),
  CHECK (resolution_mode != 'alias' OR alias_name IS NOT NULL),
  FOREIGN KEY (
    preflight_id, tenant_id, template_id, template_version_id, target_account_id, snapshot_token
  ) REFERENCES hq_template_preflights(
    id, tenant_id, template_id, template_version_id, target_account_id, snapshot_token
  ) ON DELETE CASCADE
);

CREATE TABLE hq_template_distribution_runs (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  PRIMARY KEY (id, tenant_id),
  UNIQUE (tenant_id, idempotency_fingerprint),
  UNIQUE (id, tenant_id, template_id, template_version_id),
  FOREIGN KEY (template_id, tenant_id)
    REFERENCES hq_templates(id, tenant_id),
  FOREIGN KEY (template_version_id, template_id, tenant_id)
    REFERENCES hq_template_versions(id, template_id, tenant_id)
);

CREATE TABLE hq_template_distribution_results (
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  preflight_id TEXT NOT NULL,
  idempotency_fingerprint TEXT NOT NULL,
  snapshot_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'staged', 'succeeded', 'failed', 'version_conflict', 'unsupported')),
  error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  PRIMARY KEY (run_id, tenant_id, target_account_id),
  UNIQUE (tenant_id, target_account_id, idempotency_fingerprint),
  UNIQUE (preflight_id, tenant_id),
  FOREIGN KEY (run_id, tenant_id, template_id, template_version_id)
    REFERENCES hq_template_distribution_runs(id, tenant_id, template_id, template_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY (
    preflight_id, tenant_id, template_id, template_version_id, target_account_id, snapshot_token
  ) REFERENCES hq_template_preflights(
    id, tenant_id, template_id, template_version_id, target_account_id, snapshot_token
  )
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
  PRIMARY KEY (run_id, tenant_id, target_account_id, object_key),
  FOREIGN KEY (run_id, tenant_id, target_account_id)
    REFERENCES hq_template_distribution_results(run_id, tenant_id, target_account_id)
    ON DELETE CASCADE
);

CREATE TRIGGER hq_template_preflight_terminal_guard
BEFORE UPDATE ON hq_template_preflights
WHEN OLD.status IN ('expired', 'consumed') AND NEW.status != OLD.status
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_PREFLIGHT_TERMINAL'); END;

CREATE TRIGGER hq_template_preflight_binding_guard
BEFORE UPDATE ON hq_template_preflights
WHEN NEW.id != OLD.id
  OR NEW.tenant_id != OLD.tenant_id
  OR NEW.template_id != OLD.template_id
  OR NEW.template_version_id != OLD.template_version_id
  OR NEW.target_account_id != OLD.target_account_id
  OR NEW.distribution_mode != OLD.distribution_mode
  OR NEW.idempotency_fingerprint != OLD.idempotency_fingerprint
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_PREFLIGHT_BINDING_IMMUTABLE'); END;

CREATE TRIGGER hq_template_run_binding_guard
BEFORE UPDATE ON hq_template_distribution_runs
WHEN NEW.id != OLD.id
  OR NEW.tenant_id != OLD.tenant_id
  OR NEW.template_id != OLD.template_id
  OR NEW.template_version_id != OLD.template_version_id
  OR NEW.idempotency_fingerprint != OLD.idempotency_fingerprint
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_RUN_BINDING_IMMUTABLE'); END;

CREATE TRIGGER hq_template_run_terminal_guard
BEFORE UPDATE OF status ON hq_template_distribution_runs
WHEN OLD.status != 'running' AND NEW.status != OLD.status
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_RUN_TERMINAL'); END;

CREATE TRIGGER hq_template_result_binding_guard
BEFORE UPDATE ON hq_template_distribution_results
WHEN NEW.tenant_id != OLD.tenant_id
  OR NEW.run_id != OLD.run_id
  OR NEW.template_id != OLD.template_id
  OR NEW.template_version_id != OLD.template_version_id
  OR NEW.target_account_id != OLD.target_account_id
  OR NEW.preflight_id != OLD.preflight_id
  OR NEW.idempotency_fingerprint != OLD.idempotency_fingerprint
  OR NEW.snapshot_token != OLD.snapshot_token
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_RESULT_BINDING_IMMUTABLE'); END;

CREATE TRIGGER hq_template_result_terminal_guard
BEFORE UPDATE OF status ON hq_template_distribution_results
WHEN OLD.status IN ('succeeded', 'version_conflict', 'unsupported') AND NEW.status != OLD.status
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_RESULT_TERMINAL'); END;

CREATE TRIGGER hq_template_r2_state_guard
BEFORE UPDATE OF state ON hq_template_owned_r2_keys
WHEN NOT (
  NEW.state = OLD.state
  OR (OLD.state = 'staged' AND NEW.state IN ('committed', 'cleanup_pending'))
  OR (OLD.state = 'committed' AND NEW.state = 'reconciled')
  OR (OLD.state = 'cleanup_pending' AND NEW.state IN ('cleaned', 'reconciled'))
)
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_R2_INVALID_TRANSITION'); END;

CREATE TRIGGER hq_template_r2_binding_guard
BEFORE UPDATE ON hq_template_owned_r2_keys
WHEN NEW.run_id != OLD.run_id
  OR NEW.tenant_id != OLD.tenant_id
  OR NEW.target_account_id != OLD.target_account_id
  OR NEW.object_key != OLD.object_key
  OR NEW.owner_token != OLD.owner_token
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_R2_BINDING_IMMUTABLE'); END;

CREATE TRIGGER hq_template_logical_archive_only
BEFORE DELETE ON hq_templates
BEGIN SELECT RAISE(ABORT, 'HQ_TEMPLATE_USE_LOGICAL_ARCHIVE'); END;

CREATE INDEX idx_hq_templates_tenant_type
  ON hq_templates(tenant_id, template_type, archived_at, updated_at);
CREATE INDEX idx_hq_template_versions_template
  ON hq_template_versions(tenant_id, template_id, version DESC);
CREATE INDEX idx_hq_template_preflights_target
  ON hq_template_preflights(tenant_id, target_account_id, created_at);
CREATE INDEX idx_hq_template_resolutions_preflight
  ON hq_template_preflight_resolutions(tenant_id, preflight_id, source_id);
CREATE INDEX idx_hq_template_runs_template
  ON hq_template_distribution_runs(tenant_id, template_id, created_at);
CREATE INDEX idx_hq_template_results_status
  ON hq_template_distribution_results(tenant_id, run_id, status);
CREATE INDEX idx_hq_template_owned_r2_reconcile
  ON hq_template_owned_r2_keys(tenant_id, state, updated_at);
