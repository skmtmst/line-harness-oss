-- 草稿。D1 適用は別途承認。
CREATE TABLE booking_sync_rules (
 line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id),
 auto_assign INTEGER NOT NULL CHECK(auto_assign IN (0,1)),
 notify_conflicts INTEGER NOT NULL CHECK(notify_conflicts IN (0,1)),
 notify_calendar_disconnected INTEGER NOT NULL CHECK(notify_calendar_disconnected IN (0,1)),
 notify_daily_limit INTEGER NOT NULL CHECK(notify_daily_limit IN (0,1)),
 daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 1000),
 near_limit_remaining INTEGER NOT NULL CHECK(near_limit_remaining>=0 AND near_limit_remaining<daily_limit),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE booking_sync_notice_queue (
 line_account_id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE booking_sync_notices (
 id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id), notice_key TEXT NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id), target_date TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('calendar_disconnected','daily_limit','conflict')),
 status TEXT NOT NULL CHECK(status IN ('open','done','resolved')), booking_id TEXT,
 booking_count INTEGER NOT NULL DEFAULT 0, daily_limit INTEGER, message TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(line_account_id,notice_key)
);
CREATE INDEX booking_sync_notices_account ON booking_sync_notices(line_account_id,status,target_date);
CREATE TABLE booking_sync_notice_outbox (
 id TEXT PRIMARY KEY, notice_id TEXT NOT NULL REFERENCES booking_sync_notices(id), generation INTEGER NOT NULL,
 retry_key TEXT NOT NULL, sent_at TEXT, lease_until TEXT, lease_token TEXT,
 UNIQUE(notice_id,generation)
);
CREATE TRIGGER booking_sync_rules_insert AFTER INSERT ON booking_sync_rules BEGIN INSERT INTO account_settings(id,line_account_id,key,value) VALUES(lower(hex(randomblob(16))),NEW.line_account_id,'booking_auto_assign',CASE WHEN NEW.auto_assign=1 THEN 'true' ELSE 'false' END) ON CONFLICT(line_account_id,key) DO UPDATE SET value=excluded.value; INSERT INTO booking_sync_notice_queue(line_account_id) VALUES(NEW.line_account_id) ON CONFLICT(line_account_id) DO UPDATE SET generation=generation+1,updated_at=datetime('now'); END;
CREATE TRIGGER booking_sync_rules_update AFTER UPDATE ON booking_sync_rules BEGIN INSERT INTO account_settings(id,line_account_id,key,value) VALUES(lower(hex(randomblob(16))),NEW.line_account_id,'booking_auto_assign',CASE WHEN NEW.auto_assign=1 THEN 'true' ELSE 'false' END) ON CONFLICT(line_account_id,key) DO UPDATE SET value=excluded.value; INSERT INTO booking_sync_notice_queue(line_account_id) VALUES(NEW.line_account_id) ON CONFLICT(line_account_id) DO UPDATE SET generation=generation+1,updated_at=datetime('now'); END;
CREATE TRIGGER booking_auto_assign_sync_rules_insert AFTER INSERT ON account_settings WHEN NEW.key='booking_auto_assign' BEGIN UPDATE booking_sync_rules SET auto_assign=CASE WHEN NEW.value='true' THEN 1 ELSE 0 END,version=version+1,updated_at=datetime('now') WHERE line_account_id=NEW.line_account_id AND auto_assign<>CASE WHEN NEW.value='true' THEN 1 ELSE 0 END; END;
CREATE TRIGGER booking_auto_assign_sync_rules_update AFTER UPDATE ON account_settings WHEN NEW.key='booking_auto_assign' BEGIN UPDATE booking_sync_rules SET auto_assign=CASE WHEN NEW.value='true' THEN 1 ELSE 0 END,version=version+1,updated_at=datetime('now') WHERE line_account_id=NEW.line_account_id AND auto_assign<>CASE WHEN NEW.value='true' THEN 1 ELSE 0 END; END;
CREATE TRIGGER booking_sync_notice_booking_insert AFTER INSERT ON bookings BEGIN INSERT INTO booking_sync_notice_queue(line_account_id) VALUES(NEW.line_account_id) ON CONFLICT(line_account_id) DO UPDATE SET generation=generation+1,updated_at=datetime('now'); END;
CREATE TRIGGER booking_sync_notice_booking_update AFTER UPDATE ON bookings BEGIN INSERT INTO booking_sync_notice_queue(line_account_id) VALUES(NEW.line_account_id) ON CONFLICT(line_account_id) DO UPDATE SET generation=generation+1,updated_at=datetime('now'); END;
CREATE TRIGGER booking_sync_notice_booking_delete AFTER DELETE ON bookings BEGIN INSERT INTO booking_sync_notice_queue(line_account_id) VALUES(OLD.line_account_id) ON CONFLICT(line_account_id) DO UPDATE SET generation=generation+1,updated_at=datetime('now'); END;
