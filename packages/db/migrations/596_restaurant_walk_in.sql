-- 草稿。D1への適用には番号ごとのオーナー承認が必要。
-- migration-policy: table-rebuild
PRAGMA defer_foreign_keys = ON;
DROP VIEW rt_inventory_occupancy;
DROP TRIGGER rt_inventory_reservation_delete;
DROP TRIGGER rt_inventory_reservation_insert;
DROP TRIGGER rt_inventory_reservation_update;
DROP TRIGGER rt_inventory_rules_apply;
DROP TRIGGER rt_inventory_rules_slot_insert;
DROP TRIGGER rt_reservation_hold_insert;
DROP TRIGGER rt_reservation_hold_update;
DROP TRIGGER rt_reservations_rule_queue_delete;
DROP TRIGGER rt_reservations_rule_queue_insert;
DROP TRIGGER rt_reservations_rule_queue_update;
DROP TRIGGER rt_seat_waitlist_claim;
DROP TRIGGER rt_seat_waitlist_conversion;
DROP TRIGGER rt_waitlist_reservation_insert;
DROP TRIGGER rt_waitlist_reservation_update;
CREATE TABLE rt_reservations_next (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('restaurant_board', 'reszaiko', 'hotpepper', 'tabelog', 'gurunavi', 'ikyu', 'retty', 'line', 'phone', 'manual', 'walk_in')),
  external_id TEXT,
  hub_source TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  line_uid TEXT,
  guest_count INTEGER NOT NULL CHECK (guest_count > 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  table_id TEXT REFERENCES rt_tables(id) ON DELETE SET NULL,
  course_id TEXT REFERENCES rt_menu_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'seated', 'visited', 'cancelled', 'no_show')),
  allergy_note TEXT,
  note TEXT,
  sync_direction TEXT NOT NULL DEFAULT 'inbound_only' CHECK (sync_direction = 'inbound_only'),
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, media_id TEXT REFERENCES rt_media(id), hold_expires_at TEXT, cancel_reason TEXT, stay_minutes INTEGER, media_store_code TEXT, table_label TEXT, inbound_email_id TEXT REFERENCES rt_inbound_emails(id), parser_key TEXT, parser_version TEXT, waitlist_entry_id TEXT);
INSERT INTO rt_reservations_next SELECT * FROM rt_reservations;
CREATE TABLE rt_seat_visit_marks_next AS SELECT * FROM rt_seat_visit_marks;
DELETE FROM rt_seat_visit_marks;
DROP TABLE rt_reservations;
ALTER TABLE rt_reservations_next RENAME TO rt_reservations;
INSERT INTO rt_seat_visit_marks SELECT * FROM rt_seat_visit_marks_next;
DROP TABLE rt_seat_visit_marks_next;
CREATE VIEW rt_inventory_occupancy AS SELECT i.*,
 COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=i.store_id
  AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now'))
  AND datetime(r.starts_at)<datetime(i.starts_at, '+' || i.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(i.starts_at)),0) AS guest_count,
 COALESCE((SELECT SUM(t.max_capacity) FROM rt_tables t WHERE t.store_id=i.store_id AND t.is_active=1
  AND EXISTS (SELECT 1 FROM rt_reservations r WHERE r.table_id=t.id AND r.store_id=i.store_id
   AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now'))
   AND datetime(r.starts_at)<datetime(i.starts_at, '+' || i.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(i.starts_at))),0) AS occupied_seats,
 (SELECT json_group_array(t.id) FROM rt_tables t WHERE t.store_id=i.store_id AND t.is_active=1
  AND EXISTS (SELECT 1 FROM rt_reservations r WHERE r.table_id=t.id AND r.store_id=i.store_id
   AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now'))
   AND datetime(r.starts_at)<datetime(i.starts_at, '+' || i.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(i.starts_at))) AS occupied_table_ids_json,
 COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=i.store_id AND r.table_id IS NULL
  AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now'))
  AND datetime(r.starts_at)<datetime(i.starts_at, '+' || i.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(i.starts_at)),0) AS unassigned_guests
 FROM rt_inventory_slots i;
CREATE UNIQUE INDEX idx_rt_manual_email_import ON rt_reservations(inbound_email_id) WHERE parser_key = 'manual_import';
CREATE INDEX idx_rt_reservation_hold_expiry ON rt_reservations(hold_expires_at) WHERE status = 'pending' AND hold_expires_at IS NOT NULL;
CREATE UNIQUE INDEX idx_rt_reservations_external
  ON rt_reservations(store_id, source, external_id);
CREATE INDEX idx_rt_reservations_timeline ON rt_reservations(store_id, starts_at, status);
CREATE UNIQUE INDEX idx_rt_waitlist_conversion ON rt_reservations(waitlist_entry_id) WHERE waitlist_entry_id IS NOT NULL;
CREATE TRIGGER rt_inventory_reservation_delete AFTER DELETE ON rt_reservations BEGIN UPDATE rt_inventory_slots SET version=version+1, updated_at=datetime('now'), reserved_count=COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=rt_inventory_slots.store_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now')) AND datetime(r.starts_at)<datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(rt_inventory_slots.starts_at)),0) WHERE store_id IN (OLD.store_id); END;
CREATE TRIGGER rt_inventory_reservation_insert AFTER INSERT ON rt_reservations BEGIN UPDATE rt_inventory_slots SET version=version+1, updated_at=datetime('now'), reserved_count=COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=rt_inventory_slots.store_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now')) AND datetime(r.starts_at)<datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(rt_inventory_slots.starts_at)),0) WHERE store_id IN (NEW.store_id); END;
CREATE TRIGGER rt_inventory_reservation_update AFTER UPDATE ON rt_reservations BEGIN UPDATE rt_inventory_slots SET version=version+1, updated_at=datetime('now'), reserved_count=COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=rt_inventory_slots.store_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now')) AND datetime(r.starts_at)<datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(rt_inventory_slots.starts_at)),0) WHERE store_id IN (OLD.store_id, NEW.store_id); END;
CREATE TRIGGER rt_inventory_rules_apply AFTER UPDATE OF total_capacity,reserved_count ON rt_inventory_slots WHEN EXISTS(SELECT 1 FROM rt_inventory_rules WHERE store_id=NEW.store_id) BEGIN UPDATE rt_inventory_slots SET auto_line_original=CASE WHEN (SELECT stop_line FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN COALESCE(auto_line_original,line_capacity) ELSE NULL END, line_capacity=CASE WHEN (SELECT stop_line FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN 0 ELSE COALESCE(auto_line_original,line_capacity) END, auto_same_day_original=CASE WHEN (SELECT stop_same_day FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN COALESCE(auto_same_day_original,same_day_capacity) ELSE NULL END, same_day_capacity=CASE WHEN (SELECT stop_same_day FROM rt_inventory_rules WHERE store_id=NEW.store_id)=1 AND total_capacity-(SELECT occupied_seats+unassigned_guests FROM rt_inventory_occupancy WHERE id=NEW.id)<=(SELECT threshold FROM rt_inventory_rules WHERE store_id=NEW.store_id) THEN 0 ELSE COALESCE(auto_same_day_original,same_day_capacity) END, version=version+1,updated_at=datetime('now') WHERE id=NEW.id; END;
CREATE TRIGGER rt_inventory_rules_slot_insert AFTER INSERT ON rt_inventory_slots BEGIN UPDATE rt_inventory_slots SET reserved_count=COALESCE((SELECT guest_count FROM rt_inventory_occupancy WHERE id=NEW.id),0) WHERE id=NEW.id; INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'inventory_generated') ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_reservation_hold_insert BEFORE INSERT ON rt_reservations
WHEN NEW.table_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'no_show')
 AND EXISTS (SELECT 1 FROM rt_reservations r WHERE r.store_id = NEW.store_id AND r.table_id = NEW.table_id
  AND r.status NOT IN ('cancelled', 'no_show') AND datetime(r.starts_at) < datetime(NEW.ends_at) AND datetime(r.ends_at) > datetime(NEW.starts_at)
  AND (NEW.hold_expires_at IS NOT NULL OR r.hold_expires_at IS NOT NULL)
  AND (r.hold_expires_at IS NULL OR r.status <> 'pending' OR datetime(r.hold_expires_at) > datetime('now')))
BEGIN SELECT RAISE(ABORT, 'restaurant_table_conflict'); END;
CREATE TRIGGER rt_reservation_hold_update BEFORE UPDATE OF table_id, starts_at, ends_at, status ON rt_reservations
WHEN NEW.table_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'no_show')
 AND EXISTS (SELECT 1 FROM rt_reservations r WHERE r.id <> NEW.id AND r.store_id = NEW.store_id AND r.table_id = NEW.table_id
  AND r.status NOT IN ('cancelled', 'no_show') AND datetime(r.starts_at) < datetime(NEW.ends_at) AND datetime(r.ends_at) > datetime(NEW.starts_at)
  AND (NEW.hold_expires_at IS NOT NULL OR r.hold_expires_at IS NOT NULL)
  AND (r.hold_expires_at IS NULL OR r.status <> 'pending' OR datetime(r.hold_expires_at) > datetime('now')))
BEGIN SELECT RAISE(ABORT, 'restaurant_table_conflict'); END;
CREATE TRIGGER rt_reservations_rule_queue_delete AFTER DELETE ON rt_reservations BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(OLD.store_id,'rt_reservations:delete:'||OLD.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_reservations_rule_queue_insert AFTER INSERT ON rt_reservations BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rt_reservations:insert:'||NEW.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_reservations_rule_queue_update AFTER UPDATE ON rt_reservations BEGIN INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'rt_reservations:update:'||NEW.id) ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TRIGGER rt_seat_waitlist_claim BEFORE UPDATE OF status ON rt_seat_waitlist WHEN NEW.status='invited' AND OLD.status='waiting' AND (EXISTS(SELECT 1 FROM rt_reservations r WHERE r.store_id=NEW.store_id AND r.table_id=NEW.table_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR julianday(r.hold_expires_at)>julianday('now')) AND julianday(r.starts_at)<julianday(NEW.ends_at) AND julianday(r.ends_at)>julianday(NEW.starts_at)) OR EXISTS(SELECT 1 FROM rt_seat_waitlist w WHERE w.id<>NEW.id AND w.store_id=NEW.store_id AND w.table_id=NEW.table_id AND w.status='invited' AND julianday(w.hold_expires_at)>julianday('now') AND julianday(w.starts_at)<julianday(NEW.ends_at) AND julianday(w.ends_at)>julianday(NEW.starts_at))) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER rt_seat_waitlist_conversion AFTER INSERT ON rt_reservations WHEN NEW.waitlist_entry_id IS NOT NULL BEGIN UPDATE rt_seat_waitlist SET status='converted',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.waitlist_entry_id; END;
CREATE TRIGGER rt_waitlist_reservation_insert BEFORE INSERT ON rt_reservations WHEN NEW.status NOT IN ('cancelled','no_show') AND ((NEW.waitlist_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rt_seat_waitlist w JOIN rt_reservations r ON r.waitlist_entry_id=w.id WHERE r.id=NEW.id AND w.id=NEW.waitlist_entry_id AND w.status='converted') AND NOT EXISTS(SELECT 1 FROM rt_seat_waitlist w WHERE w.id=NEW.waitlist_entry_id AND w.store_id=NEW.store_id AND w.line_uid=NEW.line_uid AND w.table_id=NEW.table_id AND w.guest_count=NEW.guest_count AND julianday(w.starts_at)=julianday(NEW.starts_at) AND julianday(w.ends_at)=julianday(NEW.ends_at) AND ((w.status='invited' AND julianday(w.hold_expires_at)>julianday('now')) OR (w.status='converted' AND EXISTS(SELECT 1 FROM rt_reservations r WHERE r.id=NEW.id AND r.waitlist_entry_id=w.id))))) OR (EXISTS(SELECT 1 FROM rt_seat_waitlist w WHERE w.store_id=NEW.store_id AND w.status='invited' AND julianday(w.hold_expires_at)>julianday('now') AND COALESCE(NEW.waitlist_entry_id,'')<>w.id AND (NEW.table_id IS NULL OR w.table_id=NEW.table_id) AND julianday(w.starts_at)<julianday(NEW.ends_at) AND julianday(w.ends_at)>julianday(NEW.starts_at))) OR (NEW.waitlist_entry_id IS NOT NULL AND (EXISTS(SELECT 1 FROM rt_reservations r WHERE r.id<>NEW.id AND r.store_id=NEW.store_id AND r.table_id=NEW.table_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR julianday(r.hold_expires_at)>julianday('now')) AND julianday(r.starts_at)<julianday(NEW.ends_at) AND julianday(r.ends_at)>julianday(NEW.starts_at))))) BEGIN SELECT RAISE(ABORT,'restaurant_table_conflict'); END;
CREATE TRIGGER rt_waitlist_reservation_update BEFORE UPDATE OF table_id,starts_at,ends_at,status ON rt_reservations WHEN NEW.status NOT IN ('cancelled','no_show') AND ((NEW.waitlist_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rt_seat_waitlist w JOIN rt_reservations r ON r.waitlist_entry_id=w.id WHERE r.id=NEW.id AND w.id=NEW.waitlist_entry_id AND w.status='converted') AND NOT EXISTS(SELECT 1 FROM rt_seat_waitlist w WHERE w.id=NEW.waitlist_entry_id AND w.store_id=NEW.store_id AND w.line_uid=NEW.line_uid AND w.table_id=NEW.table_id AND w.guest_count=NEW.guest_count AND julianday(w.starts_at)=julianday(NEW.starts_at) AND julianday(w.ends_at)=julianday(NEW.ends_at) AND ((w.status='invited' AND julianday(w.hold_expires_at)>julianday('now')) OR (w.status='converted' AND EXISTS(SELECT 1 FROM rt_reservations r WHERE r.id=NEW.id AND r.waitlist_entry_id=w.id))))) OR (EXISTS(SELECT 1 FROM rt_seat_waitlist w WHERE w.store_id=NEW.store_id AND w.status='invited' AND julianday(w.hold_expires_at)>julianday('now') AND COALESCE(NEW.waitlist_entry_id,'')<>w.id AND (NEW.table_id IS NULL OR w.table_id=NEW.table_id) AND julianday(w.starts_at)<julianday(NEW.ends_at) AND julianday(w.ends_at)>julianday(NEW.starts_at))) OR (NEW.waitlist_entry_id IS NOT NULL AND (EXISTS(SELECT 1 FROM rt_reservations r WHERE r.id<>NEW.id AND r.store_id=NEW.store_id AND r.table_id=NEW.table_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR julianday(r.hold_expires_at)>julianday('now')) AND julianday(r.starts_at)<julianday(NEW.ends_at) AND julianday(r.ends_at)>julianday(NEW.starts_at))))) BEGIN SELECT RAISE(ABORT,'restaurant_table_conflict'); END;
ALTER TABLE rt_seat_visit_marks ADD COLUMN undone_at TEXT;
ALTER TABLE rt_seat_visit_marks ADD COLUMN undone_by TEXT;
