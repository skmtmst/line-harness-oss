-- B-333: approved reserve 690. Encrypted, short-lived work payload; not a debug log.
CREATE TABLE incoming_webhook_queue (
  source_event_id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES incoming_webhooks(id),
  signature_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  payload_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_incoming_webhook_queue_due ON incoming_webhook_queue(status,next_attempt_at);

CREATE TABLE operator_notification_occurrences (
 rule_id TEXT NOT NULL, line_account_id TEXT NOT NULL, source_event_id TEXT NOT NULL,
 instance_id TEXT NOT NULL REFERENCES notification_instances(id) ON DELETE CASCADE,
 PRIMARY KEY(rule_id,line_account_id,source_event_id)
);
