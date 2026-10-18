-- B-344 approved 2026-10-16. Simulation attribution is kept apart from live results.
CREATE TABLE ec_auto_line_attribution_events (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),send_id TEXT NOT NULL REFERENCES ec_auto_line_sends(id),friend_id TEXT NOT NULL REFERENCES friends(id),
 kind TEXT NOT NULL CHECK(kind IN('click','purchase')),external_event_id TEXT NOT NULL,order_id TEXT,amount INTEGER CHECK(amount>=0),occurred_at TEXT NOT NULL,
 test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),request_json TEXT NOT NULL,
 UNIQUE(account_id,external_event_id)
);
CREATE UNIQUE INDEX ec_auto_line_attribution_order ON ec_auto_line_attribution_events(account_id,order_id) WHERE kind='purchase';
CREATE INDEX ec_auto_line_attribution_send ON ec_auto_line_attribution_events(send_id,kind,occurred_at);
