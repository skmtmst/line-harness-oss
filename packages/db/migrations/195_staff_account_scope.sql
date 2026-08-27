-- Store which LINE accounts a staff member may be assigned to manage.
-- Authorization continues to use the existing tenant-wide rules until a later migration.
ALTER TABLE staff_members
  ADD COLUMN account_scope TEXT NOT NULL DEFAULT 'all'
  CHECK (account_scope IN ('all', 'accounts'));

CREATE TABLE IF NOT EXISTS staff_account_scopes (
  staff_id        TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (staff_id, line_account_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_account_scopes_account
  ON staff_account_scopes(line_account_id);
