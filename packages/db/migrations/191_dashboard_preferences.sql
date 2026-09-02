-- V6 dashboard card layout, stored per operator and LINE account.
-- Browser storage remains only a cache; these tables are the source of truth.

CREATE TABLE IF NOT EXISTS dashboard_default_preferences (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  cards TEXT NOT NULL CHECK (json_valid(cards)),
  updated_by TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS dashboard_preferences (
  staff_id TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  cards TEXT NOT NULL CHECK (json_valid(cards)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (staff_id, line_account_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_preferences_account
  ON dashboard_preferences(line_account_id, updated_at DESC);
