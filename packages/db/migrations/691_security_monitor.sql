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

-- Preserve original timestamps. Materialize UTC for indexed, exact 15-minute reads.
-- A normal column (rather than a date-function expression index) also works with
-- test clocks. Backfill/index construction is a one-time owner-approved DB step.
ALTER TABLE audit_events ADD COLUMN security_created_at_jd REAL;
ALTER TABLE platform_audit_logs ADD COLUMN security_created_at_jd REAL;

UPDATE audit_events SET security_created_at_jd = julianday(CASE WHEN substr(created_at, 20) NOT GLOB '*[Z+-]*' THEN created_at || '+09:00' ELSE created_at END);
CREATE INDEX idx_audit_events_security_utc ON audit_events (security_created_at_jd);
CREATE TRIGGER audit_events_security_time_insert AFTER INSERT ON audit_events
BEGIN UPDATE audit_events SET security_created_at_jd = julianday(CASE WHEN substr(NEW.created_at, 20) NOT GLOB '*[Z+-]*' THEN NEW.created_at || '+09:00' ELSE NEW.created_at END) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER audit_events_security_time_update AFTER UPDATE OF created_at ON audit_events
BEGIN UPDATE audit_events SET security_created_at_jd = julianday(CASE WHEN substr(NEW.created_at, 20) NOT GLOB '*[Z+-]*' THEN NEW.created_at || '+09:00' ELSE NEW.created_at END) WHERE rowid = NEW.rowid; END;

UPDATE platform_audit_logs SET security_created_at_jd = julianday(CASE WHEN substr(created_at, 20) NOT GLOB '*[Z+-]*' THEN created_at || '+09:00' ELSE created_at END);
CREATE INDEX idx_platform_audit_logs_security_utc ON platform_audit_logs (security_created_at_jd);
CREATE TRIGGER platform_audit_logs_security_time_insert AFTER INSERT ON platform_audit_logs
BEGIN UPDATE platform_audit_logs SET security_created_at_jd = julianday(CASE WHEN substr(NEW.created_at, 20) NOT GLOB '*[Z+-]*' THEN NEW.created_at || '+09:00' ELSE NEW.created_at END) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER platform_audit_logs_security_time_update AFTER UPDATE OF created_at ON platform_audit_logs
BEGIN UPDATE platform_audit_logs SET security_created_at_jd = julianday(CASE WHEN substr(NEW.created_at, 20) NOT GLOB '*[Z+-]*' THEN NEW.created_at || '+09:00' ELSE NEW.created_at END) WHERE rowid = NEW.rowid; END;
