-- 草稿。D1 適用は別途承認。店頭・電話の walk_in_capacity は変更しない。
ALTER TABLE rt_inventory_slots ADD COLUMN same_day_capacity INTEGER NOT NULL DEFAULT 0 CHECK(same_day_capacity>=0);
ALTER TABLE rt_inventory_slots ADD COLUMN auto_line_original INTEGER;
ALTER TABLE rt_inventory_slots ADD COLUMN auto_same_day_original INTEGER;
ALTER TABLE staff_shifts ADD COLUMN is_responsible INTEGER NOT NULL DEFAULT 0 CHECK(is_responsible IN (0,1));
CREATE TABLE rt_inventory_rules (
 store_id TEXT PRIMARY KEY REFERENCES rt_stores(id), threshold INTEGER NOT NULL CHECK(threshold>=0),
 stop_line INTEGER NOT NULL CHECK(stop_line IN (0,1)), stop_same_day INTEGER NOT NULL CHECK(stop_same_day IN (0,1)),
 notify INTEGER NOT NULL CHECK(notify IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE rt_inventory_rule_queue (
 store_id TEXT PRIMARY KEY REFERENCES rt_stores(id), generation INTEGER NOT NULL DEFAULT 1,
 cause TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE rt_inventory_rule_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, slot_id TEXT NOT NULL, starts_at TEXT NOT NULL,
 before_line INTEGER NOT NULL, after_line INTEGER NOT NULL, before_same_day INTEGER NOT NULL, after_same_day INTEGER NOT NULL,
 cause TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE rt_channel_close_tasks (
 id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES rt_stores(id), slot_id TEXT NOT NULL REFERENCES rt_inventory_slots(id),
 channel TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('close','done','reopen')),
 reason TEXT NOT NULL CHECK(reason IN ('full','limited','table_conflict')), remaining_seats INTEGER NOT NULL,
 recipient_ids_json TEXT NOT NULL DEFAULT '[]', generation INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(slot_id,channel)
);
CREATE TABLE rt_inventory_notification_outbox (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES rt_channel_close_tasks(id), generation INTEGER NOT NULL,
 membership_id TEXT NOT NULL REFERENCES rt_memberships(id), retry_key TEXT NOT NULL, sent_at TEXT,
 lease_until TEXT, lease_token TEXT, UNIQUE(task_id,generation,membership_id)
);
CREATE INDEX rt_inventory_outbox_pending ON rt_inventory_notification_outbox(sent_at,lease_until);
-- 在庫の書き換えは同じDB文の中で実行する。元の値を一度だけ保持する。
CREATE TRIGGER rt_inventory_rules_apply AFTER UPDATE OF total_capacity,reserved_count ON rt_inventory_slots WHEN EXISTS(SELECT 1 FROM rt_inventory_rules WHERE store_id=NEW.store_id) BEGIN UPDATE rt_inventory_slots SET auto_line_original=CASE WHEN (SELECT stop_line FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN COALESCE(auto_line_original,line_capacity) ELSE NULL END, line_capacity=CASE WHEN (SELECT stop_line FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN 0 ELSE COALESCE(auto_line_original,line_capacity) END, auto_same_day_original=CASE WHEN (SELECT stop_same_day FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN COALESCE(auto_same_day_original,same_day_capacity) ELSE NULL END, same_day_capacity=CASE WHEN (SELECT stop_same_day FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN 0 ELSE COALESCE(auto_same_day_original,same_day_capacity) END, version=version+1,updated_at=datetime('now') WHERE id=NEW.id; END;
CREATE TRIGGER rt_inventory_rules_log AFTER UPDATE OF line_capacity,same_day_capacity ON rt_inventory_slots WHEN (OLD.line_capacity<>NEW.line_capacity OR OLD.same_day_capacity<>NEW.same_day_capacity) AND (OLD.auto_line_original IS NOT NULL OR NEW.auto_line_original IS NOT NULL OR OLD.auto_same_day_original IS NOT NULL OR NEW.auto_same_day_original IS NOT NULL) BEGIN INSERT INTO rt_inventory_rule_log(store_id,slot_id,starts_at,before_line,after_line,before_same_day,after_same_day,cause) VALUES(NEW.store_id,NEW.id,NEW.starts_at,OLD.line_capacity,NEW.line_capacity,OLD.same_day_capacity,NEW.same_day_capacity, COALESCE((SELECT cause FROM rt_inventory_rule_queue WHERE store_id=NEW.store_id),'inventory_recalculated')); END;
CREATE TRIGGER rt_inventory_rules_changed AFTER INSERT ON rt_inventory_rules BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rules_saved') ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); UPDATE rt_inventory_slots SET reserved_count=reserved_count WHERE store_id=NEW.store_id; END;
CREATE TRIGGER rt_inventory_rules_updated AFTER UPDATE ON rt_inventory_rules BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rules_saved') ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); UPDATE rt_inventory_slots SET reserved_count=reserved_count WHERE store_id=NEW.store_id; END;
CREATE TRIGGER rt_reservations_rule_queue_insert AFTER INSERT ON rt_reservations BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rt_reservations:insert:'||NEW.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_reservations_rule_queue_update AFTER UPDATE ON rt_reservations BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rt_reservations:update:'||NEW.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_reservations_rule_queue_delete AFTER DELETE ON rt_reservations BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(OLD.store_id,'rt_reservations:delete:'||OLD.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_tables_rule_queue_insert AFTER INSERT ON rt_tables BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rt_tables:insert:'||NEW.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_tables_rule_queue_update AFTER UPDATE ON rt_tables BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rt_tables:update:'||NEW.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_tables_rule_queue_delete AFTER DELETE ON rt_tables BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(OLD.store_id,'rt_tables:delete:'||OLD.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_inventory_rules_slot_insert AFTER INSERT ON rt_inventory_slots BEGIN UPDATE rt_inventory_slots SET reserved_count=COALESCE((SELECT guest_count FROM rt_inventory_occupancy WHERE id=NEW.id),0) WHERE id=NEW.id; INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'inventory_generated') ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
