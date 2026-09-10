-- Slack is a report-only projection. Keep the stable message id and revision in
-- D1 so old tasks and concurrent deliveries do not create duplicate messages.
CREATE TABLE IF NOT EXISTS ai_loop_slack_reports (
  work_key        TEXT PRIMARY KEY,
  slack_ts        TEXT,
  revision        INTEGER NOT NULL,
  claim_token     TEXT,
  claim_expires_at INTEGER,
  updated_at      INTEGER NOT NULL,
  CHECK (revision >= 946684800000),
  CHECK ((claim_token IS NULL AND claim_expires_at IS NULL)
      OR (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL))
);
