-- 既存の本文・承認・送信状態を変更せず、未作成の送り方を表す。
DROP TRIGGER rt_followup_store_added;
DROP TRIGGER rt_followup_store_connected;
DROP TRIGGER rt_followup_anniversary_created;

ALTER TABLE rt_store_followup_step_bindings ADD COLUMN anniversary_time TEXT NOT NULL DEFAULT '10:00'
 CHECK(anniversary_time GLOB '[0-2][0-9]:[0-5][0-9]' AND anniversary_time<'24:00');

CREATE TABLE rt_store_followup_rows (
 store_id TEXT NOT NULL REFERENCES rt_stores(id),
 trigger TEXT NOT NULL CHECK(trigger IN('reservation_created','reservation_24h','reservation_2h','post_visit','review_request','waitlist_invited','anniversary_before')),
 initial_key TEXT NOT NULL,
 step_id TEXT REFERENCES scenario_steps(id) ON DELETE SET NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 PRIMARY KEY(store_id,trigger)
);
INSERT INTO rt_store_followup_rows(store_id,trigger,initial_key,step_id)
SELECT s.id,k.value,k.value,(SELECT b.step_id FROM rt_store_followup_step_bindings b
 JOIN rt_store_followup_templates t ON t.store_id=b.store_id
 JOIN scenario_steps step ON step.id=b.step_id AND step.scenario_id=t.scenario_id
 WHERE b.store_id=s.id AND b.trigger=k.value ORDER BY b.step_id LIMIT 1)
FROM rt_stores s,json_each('["reservation_created","reservation_24h","reservation_2h","post_visit","review_request","waitlist_invited","anniversary_before"]') k
WHERE EXISTS(SELECT 1 FROM rt_store_followup_templates t WHERE t.store_id=s.id)
 OR EXISTS(SELECT 1 FROM account_styles a WHERE a.line_account_id=s.line_account_id AND a.style='restaurant' AND a.selection_mode='configured');

-- 共通の編集口で結びを変更したときも、古い行の要求を拒む。
CREATE TRIGGER rt_followup_row_binding_inserted AFTER INSERT ON rt_store_followup_step_bindings BEGIN UPDATE rt_store_followup_rows SET step_id=COALESCE(step_id,NEW.step_id),version=version+1 WHERE store_id=NEW.store_id AND trigger=NEW.trigger; END;
CREATE TRIGGER rt_followup_row_binding_updated AFTER UPDATE ON rt_store_followup_step_bindings BEGIN UPDATE rt_store_followup_rows SET version=version+1 WHERE store_id=NEW.store_id AND trigger=NEW.trigger; END;
CREATE TRIGGER rt_followup_row_binding_deleted AFTER DELETE ON rt_store_followup_step_bindings BEGIN UPDATE rt_store_followup_rows SET version=version+1 WHERE store_id=OLD.store_id AND trigger=OLD.trigger; END;
CREATE TRIGGER rt_followup_row_step_deleted AFTER DELETE ON scenario_steps BEGIN UPDATE rt_store_followup_rows SET step_id=NULL,version=version+1 WHERE step_id=OLD.id; END;
CREATE TRIGGER rt_followup_store_added AFTER INSERT ON rt_stores BEGIN INSERT OR IGNORE INTO rt_store_followup_rows(store_id,trigger,initial_key) SELECT NEW.id,value,value FROM json_each('["reservation_created","reservation_24h","reservation_2h","post_visit","review_request","waitlist_invited","anniversary_before"]') WHERE NEW.line_account_id IS NOT NULL; END;
CREATE TRIGGER rt_followup_store_connected AFTER UPDATE OF line_account_id ON rt_stores WHEN OLD.line_account_id IS NULL AND NEW.line_account_id IS NOT NULL BEGIN INSERT OR IGNORE INTO rt_store_followup_rows(store_id,trigger,initial_key) SELECT NEW.id,value,value FROM json_each('["reservation_created","reservation_24h","reservation_2h","post_visit","review_request","waitlist_invited","anniversary_before"]') WHERE NEW.line_account_id IS NOT NULL; END;

-- 本体を作る前から新方式の管理対象にする。従来の本体だけを持つ店の判定も残す。
DROP TRIGGER rt_followup_customer_notice;
CREATE TRIGGER rt_followup_customer_notice AFTER INSERT ON rt_customer_notice_outbox WHEN EXISTS(SELECT 1 FROM rt_reservation_events e JOIN rt_reservation_event_receipts receipt ON receipt.event_id=e.id JOIN rt_stores s ON s.id=e.store_id AND (EXISTS(SELECT 1 FROM rt_store_followup_templates WHERE store_id=s.id) OR EXISTS(SELECT 1 FROM rt_store_followup_rows WHERE store_id=s.id)) WHERE e.reservation_id=NEW.reservation_id AND e.reservation_version=NEW.customer_version AND e.event_type='restaurant.reservation.created' AND receipt.consumer_key='followup') BEGIN UPDATE rt_customer_notice_outbox SET valid=0 WHERE id=NEW.id; END;
DROP TRIGGER rt_followup_legacy_edit;
CREATE TRIGGER rt_followup_legacy_edit BEFORE UPDATE ON rt_line_flows WHEN EXISTS(SELECT 1 FROM rt_store_followup_templates WHERE store_id=OLD.store_id) OR EXISTS(SELECT 1 FROM rt_store_followup_rows WHERE store_id=OLD.store_id) BEGIN SELECT RAISE(ABORT,'edit_restaurant_followup_in_common_scenario'); END;
