-- Owner approved 2026-10-09 (B-176). Objects live in private/form-documents/.
CREATE TABLE form_submission_files (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  form_id TEXT NOT NULL REFERENCES forms(id),
  form_version_id TEXT,
  block_id TEXT NOT NULL,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  submission_id TEXT REFERENCES form_submissions(id),
  file_kind TEXT NOT NULL CHECK (file_kind IN ('image', 'pdf', 'identity')),
  side TEXT NOT NULL CHECK (side IN ('single', 'front', 'back')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  scan_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT,
  deletion_reason TEXT
);
CREATE INDEX idx_form_submission_files_expiry ON form_submission_files(expires_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_form_submission_files_submission ON form_submission_files(submission_id);
CREATE INDEX idx_form_submission_files_owner ON form_submission_files(line_account_id, form_id, friend_id, block_id);
