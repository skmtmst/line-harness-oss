-- B-396 承認済み：登録メディアから予約写真を選ぶ。DBへの適用は別工程。
-- migration-policy: table-rebuild
ALTER TABLE menus ADD COLUMN photo_media_id TEXT;
ALTER TABLE staff ADD COLUMN photo_media_id TEXT;
ALTER TABLE staff ADD COLUMN photo_version INTEGER NOT NULL DEFAULT 1 CHECK(photo_version > 0);
ALTER TABLE booking_settings ADD COLUMN store_photo_media_id TEXT;
ALTER TABLE booking_settings ADD COLUMN store_photo_interior_media_id TEXT;
ALTER TABLE booking_settings ADD COLUMN store_photo_waiting_media_id TEXT;
ALTER TABLE booking_settings ADD COLUMN store_photo_order_json TEXT NOT NULL
  DEFAULT '["exterior","interior","waiting"]'
  CHECK (COALESCE(json_valid(store_photo_order_json) AND json_type(store_photo_order_json) = 'array'
    AND json_array_length(store_photo_order_json) = 3
    AND json_extract(store_photo_order_json,'$[0]') IN ('exterior','interior','waiting')
    AND json_extract(store_photo_order_json,'$[1]') IN ('exterior','interior','waiting')
    AND json_extract(store_photo_order_json,'$[2]') IN ('exterior','interior','waiting')
    AND json_extract(store_photo_order_json,'$[0]') <> json_extract(store_photo_order_json,'$[1]')
    AND json_extract(store_photo_order_json,'$[0]') <> json_extract(store_photo_order_json,'$[2]')
    AND json_extract(store_photo_order_json,'$[1]') <> json_extract(store_photo_order_json,'$[2]'),0));

-- 現在の7種・主キー・時刻・外部キー・走査用索引を全て保ち、予約の3種を追加。
CREATE TABLE media_usages_new (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  ref_kind TEXT NOT NULL CHECK (ref_kind IN (
    'template','broadcast','rich_menu','scenario_step','nen_column','event','webinar',
    'booking_menu','booking_staff','booking_settings')),
  ref_id TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (media_id, ref_kind, ref_id)
);
INSERT INTO media_usages_new SELECT media_id, ref_kind, ref_id, scanned_at FROM media_usages;
DROP TABLE media_usages;
ALTER TABLE media_usages_new RENAME TO media_usages;
CREATE INDEX idx_media_usages_media_scanned ON media_usages(media_id, scanned_at);

CREATE TRIGGER booking_menu_photo_guard_insert BEFORE INSERT ON menus BEGIN SELECT CASE WHEN NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.photo_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.photo_media_id IS NULL)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; END;
CREATE TRIGGER booking_menu_photo_usage_insert AFTER INSERT ON menus BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_menu' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_menu', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;
CREATE TRIGGER booking_menu_photo_guard_update BEFORE UPDATE ON menus BEGIN SELECT CASE WHEN NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.photo_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.photo_media_id IS OLD.photo_media_id)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; END;
CREATE TRIGGER booking_menu_photo_usage_update AFTER UPDATE ON menus BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_menu' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_menu', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;
CREATE TRIGGER booking_menu_photo_usage_delete AFTER DELETE ON menus BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_menu' AND ref_id = OLD.id; END;
CREATE TRIGGER booking_staff_photo_guard_insert BEFORE INSERT ON staff BEGIN SELECT CASE WHEN NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.photo_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.photo_media_id IS NULL)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; END;
CREATE TRIGGER booking_staff_photo_usage_insert AFTER INSERT ON staff BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_staff' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_staff', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;
CREATE TRIGGER booking_staff_photo_guard_update BEFORE UPDATE ON staff BEGIN SELECT CASE WHEN NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.photo_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.photo_media_id IS OLD.photo_media_id)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; END;
CREATE TRIGGER booking_staff_photo_usage_update AFTER UPDATE ON staff BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_staff' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_staff', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;
CREATE TRIGGER booking_staff_photo_usage_delete AFTER DELETE ON staff BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_staff' AND ref_id = OLD.id; END;
CREATE TRIGGER booking_settings_photo_guard_insert BEFORE INSERT ON booking_settings BEGIN SELECT CASE WHEN NEW.store_photo_media_id IS NOT NULL AND 1 AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.store_photo_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.store_photo_media_id IS NULL)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; SELECT CASE WHEN NEW.store_photo_interior_media_id IS NOT NULL AND 1 AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.store_photo_interior_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.store_photo_interior_media_id IS NULL)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; SELECT CASE WHEN NEW.store_photo_waiting_media_id IS NOT NULL AND 1 AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.store_photo_waiting_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.store_photo_waiting_media_id IS NULL)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; END;
CREATE TRIGGER booking_settings_photo_usage_insert AFTER INSERT ON booking_settings BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_settings' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.store_photo_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_interior_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_interior_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_waiting_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_waiting_media_id IS NOT NULL AND 1; END;
CREATE TRIGGER booking_settings_photo_guard_update BEFORE UPDATE ON booking_settings BEGIN SELECT CASE WHEN NEW.store_photo_media_id IS NOT NULL AND 1 AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.store_photo_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.store_photo_media_id IS OLD.store_photo_media_id)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; SELECT CASE WHEN NEW.store_photo_interior_media_id IS NOT NULL AND 1 AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.store_photo_interior_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.store_photo_interior_media_id IS OLD.store_photo_interior_media_id)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; SELECT CASE WHEN NEW.store_photo_waiting_media_id IS NOT NULL AND 1 AND NOT EXISTS (SELECT 1 FROM media WHERE id = NEW.store_photo_waiting_media_id AND line_account_id = NEW.line_account_id AND kind = 'image' AND (archived_at IS NULL OR NEW.store_photo_waiting_media_id IS OLD.store_photo_waiting_media_id)) THEN RAISE(ABORT, 'booking_photo_media_unavailable') END; END;
CREATE TRIGGER booking_settings_photo_usage_update AFTER UPDATE ON booking_settings BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_settings' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.store_photo_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_interior_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_interior_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_waiting_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_waiting_media_id IS NOT NULL AND 1; END;
CREATE TRIGGER booking_settings_photo_usage_delete AFTER DELETE ON booking_settings BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_settings' AND ref_id = OLD.id; END;
