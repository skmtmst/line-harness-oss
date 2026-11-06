-- 卓の占有席数と人数を分ける。2名が4名卓を使うと空きは4席減る。
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
CREATE TRIGGER rt_inventory_reservation_insert AFTER INSERT ON rt_reservations BEGIN UPDATE rt_inventory_slots SET version=version+1, updated_at=datetime('now'), reserved_count=COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=rt_inventory_slots.store_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now')) AND datetime(r.starts_at)<datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(rt_inventory_slots.starts_at)),0) WHERE store_id IN (NEW.store_id); END;
CREATE TRIGGER rt_inventory_reservation_update AFTER UPDATE ON rt_reservations BEGIN UPDATE rt_inventory_slots SET version=version+1, updated_at=datetime('now'), reserved_count=COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=rt_inventory_slots.store_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now')) AND datetime(r.starts_at)<datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(rt_inventory_slots.starts_at)),0) WHERE store_id IN (OLD.store_id, NEW.store_id); END;
CREATE TRIGGER rt_inventory_reservation_delete AFTER DELETE ON rt_reservations BEGIN UPDATE rt_inventory_slots SET version=version+1, updated_at=datetime('now'), reserved_count=COALESCE((SELECT SUM(r.guest_count) FROM rt_reservations r WHERE r.store_id=rt_inventory_slots.store_id AND r.status NOT IN ('cancelled','no_show') AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR datetime(r.hold_expires_at)>datetime('now')) AND datetime(r.starts_at)<datetime(rt_inventory_slots.starts_at, '+' || rt_inventory_slots.slot_minutes || ' minutes') AND datetime(r.ends_at)>datetime(rt_inventory_slots.starts_at)),0) WHERE store_id IN (OLD.store_id); END;
UPDATE rt_inventory_slots SET reserved_count=COALESCE((SELECT guest_count FROM rt_inventory_occupancy v WHERE v.id=rt_inventory_slots.id),0);
