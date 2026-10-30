-- WebAuthn public credentials and one-use challenges. Private keys never reach this database.
CREATE TABLE staff_passkeys (
  credential_id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(transports)),
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_staff_passkeys_staff ON staff_passkeys(staff_id, created_at);

CREATE TABLE staff_passkey_challenges (
  token_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'login')),
  staff_id TEXT REFERENCES staff_members(id) ON DELETE CASCADE,
  session_token_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_staff_passkey_challenges_expires ON staff_passkey_challenges(expires_at);
