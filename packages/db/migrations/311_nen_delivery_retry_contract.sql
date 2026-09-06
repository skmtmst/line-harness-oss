ALTER TABLE nen_delivery_jobs
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

ALTER TABLE nen_delivery_jobs
  ADD COLUMN retry_generation INTEGER NOT NULL DEFAULT 0 CHECK (retry_generation >= 0);

ALTER TABLE nen_delivery_jobs
  ADD COLUMN last_retry_reason TEXT CHECK (
    last_retry_reason IS NULL OR length(last_retry_reason) BETWEEN 1 AND 500
  );

ALTER TABLE nen_delivery_jobs
  ADD COLUMN last_retry_requested_by TEXT;

ALTER TABLE nen_delivery_jobs
  ADD COLUMN last_retry_requested_at TEXT;

CREATE INDEX IF NOT EXISTS idx_nen_delivery_jobs_account_schedule
  ON nen_delivery_jobs(line_account_id, scheduled_at DESC, id DESC);
