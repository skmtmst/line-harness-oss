-- B-333 / B-337: approved reserve 689. Schema only; no remote application.
ALTER TABLE nen_delivery_jobs ADD COLUMN next_attempt_at TEXT;
ALTER TABLE nen_pet_profiles ADD COLUMN archived_at TEXT;
CREATE INDEX idx_nen_delivery_retry_due ON nen_delivery_jobs(status, next_attempt_at);

ALTER TABLE ec_events ADD COLUMN identity_recovery_mode TEXT CHECK(identity_recovery_mode IN ('analytics_snapshot','non_delivery_actions'));
ALTER TABLE nen_delivery_jobs ADD COLUMN claim_token TEXT;
