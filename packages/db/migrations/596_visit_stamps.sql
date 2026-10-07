-- 草稿。D1適用はオーナー承認後に司令塔が行う。マイルとは別の台帳。
CREATE TABLE visit_stamp_cards (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json)), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 write_token TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE visit_stamp_card_accounts (
 card_id TEXT NOT NULL REFERENCES visit_stamp_cards(id), line_account_id TEXT NOT NULL REFERENCES line_accounts(id), PRIMARY KEY(card_id,line_account_id)
);
CREATE TABLE visit_stamp_wallets (
 card_id TEXT NOT NULL REFERENCES visit_stamp_cards(id), friend_id TEXT NOT NULL REFERENCES friends(id),
 version INTEGER NOT NULL DEFAULT 0, balance INTEGER NOT NULL DEFAULT 0, earned_total INTEGER NOT NULL DEFAULT 0, visit_count INTEGER NOT NULL DEFAULT 0, expires_at TEXT, last_visit_at TEXT,
 PRIMARY KEY(card_id,friend_id)
);
CREATE TABLE visit_stamp_entries (
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES visit_stamp_cards(id), friend_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('visit','manual','paper','redeem','reverse','restore','expire')), delta INTEGER NOT NULL,
 actor_id TEXT, reason TEXT NOT NULL, idempotency_key TEXT NOT NULL, original_id TEXT UNIQUE REFERENCES visit_stamp_entries(id),
 visit_key TEXT, expires_at TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(card_id,friend_id,idempotency_key)
);
CREATE UNIQUE INDEX visit_stamp_one_visit ON visit_stamp_entries(card_id,friend_id,visit_key) WHERE kind='visit';
CREATE TRIGGER visit_stamp_entry_balance AFTER INSERT ON visit_stamp_entries BEGIN UPDATE visit_stamp_wallets SET version=version+1, visit_count=CASE WHEN NEW.kind='visit' THEN visit_count+1 WHEN NEW.kind='paper' AND NEW.delta>0 THEN MAX(visit_count,1) ELSE visit_count END, balance=balance+NEW.delta, earned_total=earned_total+CASE WHEN NEW.kind IN ('visit','manual','paper') AND NEW.delta>0 THEN NEW.delta ELSE 0 END, last_visit_at=CASE WHEN NEW.kind='visit' THEN NEW.occurred_at ELSE last_visit_at END, expires_at=CASE WHEN NEW.kind IN ('visit','manual','paper') THEN NEW.expires_at ELSE expires_at END WHERE card_id=NEW.card_id AND friend_id=NEW.friend_id; END;
CREATE TABLE visit_stamp_redemptions (
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES visit_stamp_cards(id), friend_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
 reward_id TEXT NOT NULL, reward_name TEXT NOT NULL, stamps INTEGER NOT NULL CHECK(stamps>0),
 status TEXT NOT NULL DEFAULT 'offered' CHECK(status IN ('offered','used','cancelled')), request_id TEXT NOT NULL,
 used_by TEXT, used_at TEXT, cancelled_at TEXT, created_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(card_id,friend_id,request_id)
);
CREATE TABLE visit_stamp_staff_pins (
 line_account_id TEXT NOT NULL REFERENCES line_accounts(id), staff_id TEXT NOT NULL REFERENCES staff_members(id),
 salt TEXT NOT NULL, hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
 updated_at TEXT NOT NULL DEFAULT(datetime('now')), PRIMARY KEY(line_account_id,staff_id)
);
CREATE TABLE visit_stamp_paper_requests (
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES visit_stamp_cards(id), friend_id TEXT NOT NULL REFERENCES friends(id),
 line_account_id TEXT NOT NULL REFERENCES line_accounts(id), photo_url TEXT NOT NULL, stamps INTEGER NOT NULL CHECK(stamps BETWEEN 1 AND 10000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reason TEXT, reviewed_by TEXT, reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE UNIQUE INDEX visit_stamp_one_paper ON visit_stamp_paper_requests(card_id,friend_id) WHERE status IN ('pending','approved');
CREATE TABLE visit_stamp_visit_queue (
 kind TEXT NOT NULL CHECK(kind IN ('restaurant','booking')), visit_id TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT(datetime('now')), PRIMARY KEY(kind,visit_id)
);
CREATE TABLE visit_stamp_checkouts (
 kind TEXT NOT NULL CHECK(kind IN ('restaurant','booking')), visit_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>=0), recorded_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')), PRIMARY KEY(kind,visit_id)
);
CREATE TRIGGER visit_stamp_rt_insert AFTER INSERT ON rt_reservations WHEN NEW.status IN ('visited','seated') BEGIN INSERT INTO visit_stamp_visit_queue(kind,visit_id) VALUES('restaurant',NEW.id) ON CONFLICT(kind,visit_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER visit_stamp_rt_update AFTER UPDATE OF status ON rt_reservations WHEN NEW.status<>OLD.status AND (NEW.status IN ('visited','seated') OR OLD.status IN ('visited','seated')) BEGIN INSERT INTO visit_stamp_visit_queue(kind,visit_id) VALUES('restaurant',NEW.id) ON CONFLICT(kind,visit_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER visit_stamp_booking_update AFTER UPDATE OF status ON bookings WHEN NEW.status<>OLD.status AND (NEW.status='completed' OR OLD.status='completed') BEGIN INSERT INTO visit_stamp_visit_queue(kind,visit_id) VALUES('booking',NEW.id) ON CONFLICT(kind,visit_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER visit_stamp_booking_mark AFTER INSERT ON booking_visit_marks WHEN NEW.kind='visited' BEGIN INSERT INTO visit_stamp_visit_queue(kind,visit_id) VALUES('booking',NEW.booking_id) ON CONFLICT(kind,visit_id) DO UPDATE SET generation=generation+1; END;
