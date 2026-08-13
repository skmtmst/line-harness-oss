CREATE TABLE IF NOT EXISTS support_email_sync_state (
  mailbox TEXT PRIMARY KEY,
  uid_validity TEXT,
  last_uid INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
