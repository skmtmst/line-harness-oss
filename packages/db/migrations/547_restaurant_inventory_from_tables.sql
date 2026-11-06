-- 卓の変更も予約枠の版に含め、古い配分を保存してしまうことを防ぐ。
ALTER TABLE rt_inventory_slots ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE rt_inventory_slots ADD COLUMN updated_by TEXT;
UPDATE rt_inventory_slots SET total_capacity = COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id = rt_inventory_slots.store_id AND is_active = 1), 0);
CREATE TRIGGER rt_inventory_slot_insert AFTER INSERT ON rt_inventory_slots BEGIN UPDATE rt_inventory_slots SET total_capacity = COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id = NEW.store_id AND is_active = 1), 0) WHERE id = NEW.id; END;
CREATE TRIGGER rt_inventory_table_insert AFTER INSERT ON rt_tables BEGIN UPDATE rt_inventory_slots SET total_capacity = COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id = NEW.store_id AND is_active = 1), 0), version = version + 1, updated_at = datetime('now') WHERE store_id = NEW.store_id; END;
CREATE TRIGGER rt_inventory_table_update AFTER UPDATE OF max_capacity, is_active, store_id ON rt_tables BEGIN UPDATE rt_inventory_slots SET total_capacity = COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id = rt_inventory_slots.store_id AND is_active = 1), 0), version = version + 1, updated_at = datetime('now') WHERE store_id IN (OLD.store_id, NEW.store_id); END;
CREATE TRIGGER rt_inventory_table_delete AFTER DELETE ON rt_tables BEGIN UPDATE rt_inventory_slots SET total_capacity = COALESCE((SELECT SUM(max_capacity) FROM rt_tables WHERE store_id = OLD.store_id AND is_active = 1), 0), version = version + 1, updated_at = datetime('now') WHERE store_id = OLD.store_id; END;

CREATE TABLE rt_opening_hours_settings (
  store_id TEXT PRIMARY KEY REFERENCES rt_stores(id) ON DELETE CASCADE,
  hours_json TEXT NOT NULL CHECK (json_valid(hours_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
