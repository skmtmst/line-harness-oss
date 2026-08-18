-- Login user invitations and per-user access preferences (V2 10-2 / 10-2-1).
ALTER TABLE staff_members ADD COLUMN permission_keys TEXT NOT NULL DEFAULT '[]';
ALTER TABLE staff_members ADD COLUMN notification_preferences TEXT NOT NULL DEFAULT '{}';
ALTER TABLE staff_members ADD COLUMN invite_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE staff_members ADD COLUMN invite_token_hash TEXT;
ALTER TABLE staff_members ADD COLUMN invite_expires_at TEXT;
ALTER TABLE staff_members ADD COLUMN email_verified_at TEXT;
ALTER TABLE staff_members ADD COLUMN line_linked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_members_invite_token
  ON staff_members(invite_token_hash);
