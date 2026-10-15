-- B-343: owner-approved B-344 reserve 691. Prepare only; applying needs separate approval.
-- Store counts and fixed rule keys only. No request bodies, URLs, names, IPs or secrets.
CREATE TABLE security_monitor_state (
  id TEXT PRIMARY KEY CHECK (id = 'security'),
  lease_until TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  last_started_at TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  last_completed_at TEXT,
  last_error TEXT
);

CREATE TABLE security_alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  line_account_id TEXT,
  scope_key TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  observed_count INTEGER NOT NULL CHECK (observed_count >= 0),
  threshold_count INTEGER NOT NULL CHECK (threshold_count > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  latest_event_at REAL NOT NULL,
  reviewed_at TEXT,
  slack_sent_version INTEGER NOT NULL DEFAULT 0,
  notification_id TEXT NOT NULL,
  slack_lease_until TEXT,
  slack_lease_token TEXT,
  slack_last_error TEXT,
  UNIQUE (scope_key, rule_key)
);
CREATE INDEX idx_security_alerts_scope ON security_alerts(tenant_id, line_account_id, status);
CREATE INDEX idx_security_alerts_pending ON security_alerts(slack_sent_version, version);

-- Candidate dates use this plain index; exact UTC comparison happens after it.
-- platform_audit_logs already has an index on created_at.
CREATE INDEX idx_audit_events_security_created ON audit_events (created_at);
