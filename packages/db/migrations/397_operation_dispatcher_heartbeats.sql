-- Scheduled delivery dispatchers record one global heartbeat per manifest job.
-- Payloads and errors are deliberately excluded: operations health needs only
-- liveness and the last outcome, never customer content or credentials.
CREATE TABLE operation_dispatcher_heartbeats (
  job_name         TEXT PRIMARY KEY,
  last_started_at  TEXT NOT NULL,
  last_completed_at TEXT,
  last_status      TEXT NOT NULL CHECK (last_status IN ('running', 'succeeded', 'failed')),
  updated_at       TEXT NOT NULL
);
