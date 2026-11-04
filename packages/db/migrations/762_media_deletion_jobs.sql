-- R2 と D1 は同じトランザクションではない。削除途中のキーと状態を
-- media の行とは別に保持し、失敗後も同じ操作を安全に再試行する。
CREATE TABLE IF NOT EXISTS media_deletion_jobs (
  media_id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  r2_keys_json TEXT NOT NULL CHECK (json_valid(r2_keys_json) AND json_type(r2_keys_json) = 'array'),
  status TEXT NOT NULL CHECK (status IN ('checking', 'deleting', 'completed')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- An INSERT ... SELECT only writes on a conflict; the named CHECK aborts the
-- enclosing D1 batch before it can save a reference to a deleting image.
CREATE TABLE IF NOT EXISTS media_deletion_guards (
  blocked INTEGER NOT NULL CONSTRAINT media_deletion_in_progress CHECK (blocked = 0)
);

-- A non-reversible fingerprint prevents reuse of a removed object key even
-- after account-scoped deletion jobs have been purged. No account or URL is kept.
CREATE TABLE IF NOT EXISTS media_deleted_key_fingerprints (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')
);

-- A short-lived reference protects a registered image during a chat send.
-- A claim is account-scoped and contains no message or customer content.
CREATE TABLE IF NOT EXISTS media_send_claims (
  claim_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (claim_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_media_send_claims_expiry ON media_send_claims(expires_at);
CREATE INDEX IF NOT EXISTS idx_media_send_claims_media ON media_send_claims(media_id, expires_at);
