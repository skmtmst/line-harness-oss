-- Owner approved 2026-10-15. Preserve all columns and existing CHECK constraints.
-- No historical inventory origins are guessed. Multiple coalesced events remain explicit.
ALTER TABLE rt_channel_close_tasks ADD COLUMN trigger_reservation_id TEXT;
ALTER TABLE rt_channel_close_tasks ADD COLUMN trigger_source TEXT;
ALTER TABLE rt_channel_close_tasks ADD COLUMN trigger_sources_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(trigger_sources_json) AND json_type(trigger_sources_json)='array');
ALTER TABLE rt_reservation_close_tasks ADD COLUMN trigger_source TEXT;
CREATE TRIGGER rt_direct_close_source AFTER INSERT ON rt_reservation_close_tasks BEGIN  UPDATE rt_reservation_close_tasks SET trigger_source=(SELECT source FROM rt_reservations WHERE id=NEW.reservation_id AND store_id=NEW.store_id) WHERE id=NEW.id; END;
CREATE TABLE rt_inventory_rule_source_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 store_id TEXT NOT NULL REFERENCES rt_stores(id), slot_id TEXT NOT NULL REFERENCES rt_inventory_slots(id),
 reservation_id TEXT NOT NULL, source TEXT NOT NULL, event TEXT NOT NULL CHECK(event IN ('insert','update','delete')),
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX rt_inventory_rule_source_events_slot ON rt_inventory_rule_source_events(store_id,slot_id,id);
CREATE TRIGGER rt_inventory_source_insert AFTER INSERT ON rt_reservations BEGIN  INSERT INTO rt_inventory_rule_source_events(store_id,slot_id,reservation_id,source,event)  SELECT i.store_id,i.id,NEW.id,NEW.source,'insert' FROM rt_inventory_slots i WHERE (i.store_id=NEW.store_id AND julianday(i.starts_at)<julianday(NEW.ends_at) AND julianday(i.starts_at,'+'||i.slot_minutes||' minutes')>julianday(NEW.starts_at)); END;
CREATE TRIGGER rt_inventory_source_update AFTER UPDATE ON rt_reservations WHEN OLD.store_id IS NOT NEW.store_id OR OLD.source IS NOT NEW.source OR OLD.starts_at IS NOT NEW.starts_at OR OLD.ends_at IS NOT NEW.ends_at OR OLD.guest_count IS NOT NEW.guest_count OR OLD.table_id IS NOT NEW.table_id OR OLD.status IS NOT NEW.status OR OLD.hold_expires_at IS NOT NEW.hold_expires_at OR OLD.departed_at IS NOT NEW.departed_at BEGIN INSERT INTO rt_inventory_rule_source_events(store_id,slot_id,reservation_id,source,event) SELECT i.store_id,i.id,OLD.id,OLD.source,'update' FROM rt_inventory_slots i WHERE i.store_id=OLD.store_id AND julianday(i.starts_at)<julianday(OLD.ends_at) AND julianday(i.starts_at,'+'||i.slot_minutes||' minutes')>julianday(OLD.starts_at) UNION SELECT i.store_id,i.id,NEW.id,NEW.source,'update' FROM rt_inventory_slots i WHERE i.store_id=NEW.store_id AND julianday(i.starts_at)<julianday(NEW.ends_at) AND julianday(i.starts_at,'+'||i.slot_minutes||' minutes')>julianday(NEW.starts_at); END;
CREATE TRIGGER rt_inventory_source_delete AFTER DELETE ON rt_reservations BEGIN  INSERT INTO rt_inventory_rule_source_events(store_id,slot_id,reservation_id,source,event)  SELECT i.store_id,i.id,OLD.id,OLD.source,'delete' FROM rt_inventory_slots i WHERE (i.store_id=OLD.store_id AND julianday(i.starts_at)<julianday(OLD.ends_at) AND julianday(i.starts_at,'+'||i.slot_minutes||' minutes')>julianday(OLD.starts_at)); END;
CREATE TRIGGER rt_direct_close_source_generation AFTER UPDATE OF generation ON rt_reservation_close_tasks WHEN NEW.generation<>OLD.generation AND NEW.status='close' BEGIN UPDATE rt_reservation_close_tasks SET trigger_source=(SELECT source FROM rt_reservations WHERE id=NEW.reservation_id AND store_id=NEW.store_id) WHERE id=NEW.id; END;
