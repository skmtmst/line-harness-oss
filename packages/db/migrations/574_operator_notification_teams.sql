CREATE TABLE operator_notification_teams (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  staff_ids TEXT NOT NULL CHECK(json_valid(staff_ids) AND json_type(staff_ids) = 'array'),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_operator_notification_teams_account ON operator_notification_teams(line_account_id, archived_at);
