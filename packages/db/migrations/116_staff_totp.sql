-- Authenticator (TOTP) secrets and short-lived login challenges.
-- Secrets are encrypted by the Worker before they reach D1.
ALTER TABLE staff_members ADD COLUMN totp_secret_enc TEXT;
ALTER TABLE staff_members ADD COLUMN totp_pending_secret_enc TEXT;
ALTER TABLE staff_members ADD COLUMN totp_enabled_at TEXT;
ALTER TABLE staff_members ADD COLUMN totp_last_used_step INTEGER;

CREATE TABLE IF NOT EXISTS admin_two_factor_challenges (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_two_factor_challenges_staff
  ON admin_two_factor_challenges(staff_id);
CREATE INDEX IF NOT EXISTS idx_admin_two_factor_challenges_expires
  ON admin_two_factor_challenges(expires_at);
