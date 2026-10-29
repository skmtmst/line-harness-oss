-- 公開の利用申込を、運営が連絡・承認してから初期設定へ進める。
-- 既存の登録 URL には application_id が無いため、以後は初期設定に使えない。
CREATE TABLE registration_applications (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  referral_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'contacted', 'approved', 'rejected', 'activated')),
  contact_note TEXT,
  contacted_by TEXT,
  contacted_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  invite_sent_at TEXT,
  tenant_id TEXT,
  ip_hash TEXT,
  device_marker TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_registration_applications_active_email
  ON registration_applications(lower(email)) WHERE status <> 'rejected';
CREATE INDEX idx_registration_applications_status_created
  ON registration_applications(status, created_at DESC);

ALTER TABLE auth_email_tokens ADD COLUMN application_id TEXT;
CREATE INDEX idx_auth_email_tokens_application
  ON auth_email_tokens(application_id, created_at DESC);
