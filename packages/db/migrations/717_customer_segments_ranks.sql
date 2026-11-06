-- B-344/B-349 approved 717. General ranks are separate from imported NEN ranks.
CREATE TABLE customer_activity_daily (
 account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),basis TEXT NOT NULL CHECK(basis IN('visit','purchase','both')),
 activity_count INTEGER NOT NULL,amount INTEGER NOT NULL,last_activity_at TEXT,r_bucket INTEGER,f_bucket INTEGER,m_bucket INTEGER,computed_at TEXT NOT NULL,
 PRIMARY KEY(account_id,friend_id,basis)
);
CREATE INDEX customer_activity_cells ON customer_activity_daily(account_id,basis,r_bucket,f_bucket,friend_id);
CREATE TABLE rfm_segment_names(account_id TEXT NOT NULL REFERENCES line_accounts(id),r_bucket INTEGER NOT NULL CHECK(r_bucket BETWEEN 1 AND 5),f_bucket INTEGER NOT NULL CHECK(f_bucket BETWEEN 1 AND 5),name TEXT NOT NULL,PRIMARY KEY(account_id,r_bucket,f_bucket));
CREATE TABLE member_rank_programs (
 account_id TEXT PRIMARY KEY REFERENCES line_accounts(id),metric TEXT NOT NULL DEFAULT 'visits' CHECK(metric IN('visits','amount','miles')),window_months INTEGER NOT NULL DEFAULT 6 CHECK(window_months BETWEEN 1 AND 36),
 status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN('stopped','active')),version INTEGER NOT NULL DEFAULT 1,activated_at TEXT,updated_at TEXT NOT NULL,initial_version INTEGER NOT NULL DEFAULT 0,evaluation_token TEXT
);
CREATE TABLE member_rank_tiers (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),sort INTEGER NOT NULL,name TEXT NOT NULL,threshold INTEGER NOT NULL CHECK(threshold>=0),mile_multiplier REAL NOT NULL DEFAULT 1 CHECK(mile_multiplier BETWEEN 1 AND 3),tag_id TEXT NOT NULL REFERENCES tags(id)
);
CREATE TABLE member_ranks(account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),tier_id TEXT NOT NULL REFERENCES member_rank_tiers(id),since TEXT NOT NULL,downgrade_due_at TEXT,PRIMARY KEY(account_id,friend_id));
CREATE TABLE member_rank_history(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),from_tier_id TEXT,to_tier_id TEXT NOT NULL,reason TEXT NOT NULL,notified INTEGER NOT NULL DEFAULT 0 CHECK(notified=0),at TEXT NOT NULL);
CREATE INDEX member_rank_history_friend ON member_rank_history(account_id,friend_id,at);
CREATE TABLE customer_activity_runs(account_id TEXT PRIMARY KEY REFERENCES line_accounts(id),computed_at TEXT,last_attempt_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('ready','failed')));

CREATE UNIQUE INDEX member_rank_active_sort ON member_rank_tiers(account_id,sort) WHERE sort>=0;
CREATE TABLE member_rank_mutations(account_id TEXT NOT NULL REFERENCES line_accounts(id),request_key TEXT NOT NULL,request_json TEXT NOT NULL,response_json TEXT NOT NULL,PRIMARY KEY(account_id,request_key));
