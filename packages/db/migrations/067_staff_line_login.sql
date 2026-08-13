-- LINE Login for the Harness admin dashboard.
-- Only explicitly linked, active staff members may create an admin session.
ALTER TABLE staff_members ADD COLUMN line_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_line_user_id
  ON staff_members(line_user_id)
  WHERE line_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_staff_id ON admin_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
