-- Explicit account memberships for tenant-wide administrators. A tenant-wide
-- role by itself does not make someone a member of every account's roster.
CREATE TABLE line_account_hq_admin_memberships (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (line_account_id, staff_id)
);

CREATE INDEX idx_line_account_hq_admin_memberships_staff
  ON line_account_hq_admin_memberships(staff_id);
