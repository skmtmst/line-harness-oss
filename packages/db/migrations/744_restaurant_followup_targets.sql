-- 来店フォローの各行が使う実物と、承認した版を記録する。時刻の列は増設しない。
CREATE TABLE rt_store_followup_targets (
 store_id TEXT NOT NULL,
 trigger TEXT NOT NULL,
 engine TEXT NOT NULL DEFAULT 'scenario' CHECK(engine IN ('scenario','reminder','automation')),
 reminder_id TEXT UNIQUE REFERENCES reminders(id),
 automation_id TEXT UNIQUE REFERENCES automation_definitions(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 sending_status TEXT NOT NULL DEFAULT 'stopped' CHECK(sending_status IN ('stopped','pending','active')),
 approved_version_id TEXT,
 approved_content_hash TEXT,
 approval_id TEXT REFERENCES rt_approval_requests(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
 PRIMARY KEY(store_id,trigger),
 FOREIGN KEY(store_id,trigger) REFERENCES rt_store_followup_rows(store_id,trigger),
 CHECK(engine != 'reminder' OR reminder_id IS NOT NULL),
 CHECK(engine != 'automation' OR automation_id IS NOT NULL),
 CHECK(sending_status != 'active' OR (approval_id IS NOT NULL AND approved_version_id IS NOT NULL AND approved_content_hash IS NOT NULL))
);
CREATE INDEX idx_rt_followup_targets_approval ON rt_store_followup_targets(approval_id);
-- 新しい接続の失敗と再試行を、既存の7行の予定作成から分離する。
CREATE TRIGGER rt_followup_target_event_receipt AFTER INSERT ON rt_reservation_events
 WHEN NEW.reservation_id IS NOT NULL AND NEW.event_type LIKE 'restaurant.reservation.%'
 BEGIN INSERT INTO rt_reservation_event_receipts(event_id,consumer_key) VALUES(NEW.id,'followup_targets'); END;
