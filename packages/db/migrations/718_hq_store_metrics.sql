-- B-344/B-349 approved 718. NULL means unavailable, never an observed zero.
CREATE TABLE hq_store_daily_metrics (
 account_id TEXT NOT NULL REFERENCES line_accounts(id),date TEXT NOT NULL,
 friends_added INTEGER,friends_blocked INTEGER,friends_at_start INTEGER,broadcast_recipients INTEGER,broadcast_clicks INTEGER,
 bookings INTEGER,visits INTEGER,no_shows INTEGER,first_response_median_minutes REAL,first_response_count INTEGER,
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN('ready','partial','failed')),computed_at TEXT NOT NULL,
 PRIMARY KEY(account_id,date)
);
-- Keep first human response samples after the inbox begins its next conversation cycle.
CREATE TABLE hq_store_response_samples (
 account_id TEXT NOT NULL REFERENCES line_accounts(id),chat_id TEXT NOT NULL REFERENCES chats(id),
 pending_since TEXT NOT NULL,responded_at TEXT NOT NULL,minutes REAL NOT NULL CHECK(minutes>=0),
 PRIMARY KEY(account_id,chat_id,pending_since)
);
CREATE INDEX hq_store_response_period ON hq_store_response_samples(account_id,responded_at);
CREATE TRIGGER hq_store_first_response_sample AFTER UPDATE OF first_response_at ON chats WHEN NEW.first_response_at IS NOT NULL AND NEW.pending_since IS NOT NULL AND julianday(NEW.first_response_at)>=julianday(NEW.pending_since) BEGIN INSERT OR IGNORE INTO hq_store_response_samples(account_id,chat_id,pending_since,responded_at,minutes) SELECT f.line_account_id,NEW.id,NEW.pending_since,NEW.first_response_at,(julianday(NEW.first_response_at)-julianday(NEW.pending_since))*1440 FROM friends f WHERE f.id=NEW.friend_id AND f.line_account_id IS NOT NULL; END;
