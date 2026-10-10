-- Owner approved 2026-10-08: shared checkpoints for seven audit repairs.
-- Additive only; no existing completion history is inferred.
CREATE TABLE workflow_steps (
  scope_id TEXT NOT NULL,
  process_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','exhausted','unknown','canceled')),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at INTEGER,
  retry_key TEXT NOT NULL,
  input_json TEXT,
  result_json TEXT,
  error_code TEXT,
  first_attempt_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_id, process_kind, subject_id, step_key),
  CHECK ((status = 'running' AND NOT (lease_owner IS NULL) AND NOT (lease_expires_at IS NULL))
      OR (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX workflow_steps_due ON workflow_steps(process_kind, status, next_attempt_at, lease_expires_at);
-- Banner-specific inputs cannot be reconstructed by cron from an HTTP /run body.
ALTER TABLE banner_generations ADD COLUMN crop_gravity TEXT NOT NULL DEFAULT 'center'
  CHECK (crop_gravity IN ('center','top','bottom'));
ALTER TABLE banner_generations ADD COLUMN stop_requested_at TEXT;
