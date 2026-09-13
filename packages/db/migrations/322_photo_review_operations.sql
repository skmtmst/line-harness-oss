-- 写真審査の再評価・派生画像処理・原本取得を、版と実行履歴つきで追跡する。
CREATE TABLE nen_photo_assessment_runs (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_version INTEGER NOT NULL CHECK (requested_version > 0),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  provider TEXT,
  model_version TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);
CREATE INDEX idx_nen_photo_assessment_runs_photo_created
  ON nen_photo_assessment_runs(photo_id, created_at DESC);

CREATE TABLE nen_photo_asset_jobs (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  operation TEXT NOT NULL CHECK (operation IN ('review', 'public', 'thumbnail', 'all')),
  requested_version INTEGER NOT NULL CHECK (requested_version > 0),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);
CREATE INDEX idx_nen_photo_asset_jobs_photo_created
  ON nen_photo_asset_jobs(photo_id, created_at DESC);

CREATE TABLE nen_photo_derivatives (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('review', 'public', 'thumbnail')),
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  created_at TEXT NOT NULL,
  UNIQUE(photo_id, kind, source_version)
);
CREATE INDEX idx_nen_photo_derivatives_photo_kind
  ON nen_photo_derivatives(photo_id, kind, source_version DESC);

CREATE TABLE nen_photo_bulk_decision_receipts (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);

CREATE TABLE nen_photo_original_download_grants (
  token_hash TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_by TEXT NOT NULL,
  requested_version INTEGER NOT NULL CHECK (requested_version > 0),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(line_account_id, requested_by, idempotency_key)
);
CREATE INDEX idx_nen_photo_original_download_grants_expiry
  ON nen_photo_original_download_grants(line_account_id, requested_by, expires_at);

CREATE TABLE nen_photo_original_download_audit (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES nen_photo_submissions(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  requested_by TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('issued', 'downloaded')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_nen_photo_original_download_audit_photo
  ON nen_photo_original_download_audit(photo_id, created_at DESC);
