-- migration-policy: table-rebuild
-- フォームの下書き・現在公開版も、登録メディアの削除前に使用先として数える。
-- このmigrationをWorkerより先に適用する。既存の種類・行・参照制約は維持する。
CREATE TABLE media_usages_new (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  ref_kind TEXT NOT NULL CHECK (ref_kind IN (
    'template','broadcast','rich_menu','scenario_step','nen_column','event','webinar',
    'booking_menu','booking_staff','booking_settings','form')),
  ref_id TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (media_id, ref_kind, ref_id)
);
INSERT INTO media_usages_new(media_id,ref_kind,ref_id,scanned_at)
  SELECT media_id,ref_kind,ref_id,scanned_at FROM media_usages;
-- 他の表の使用台帳トリガーも元の定義で作り直す。途中の旧表参照を残さない。
DROP TRIGGER booking_menu_photo_usage_delete;
DROP TRIGGER booking_menu_photo_usage_insert;
DROP TRIGGER booking_menu_photo_usage_update;
DROP TRIGGER booking_settings_photo_usage_delete;
DROP TRIGGER booking_settings_photo_usage_insert;
DROP TRIGGER booking_settings_photo_usage_update;
DROP TRIGGER booking_staff_photo_usage_delete;
DROP TRIGGER booking_staff_photo_usage_insert;
DROP TRIGGER booking_staff_photo_usage_update;
DROP TABLE media_usages;
ALTER TABLE media_usages_new RENAME TO media_usages;
CREATE INDEX idx_media_usages_media_scanned ON media_usages(media_id,scanned_at);

CREATE TRIGGER booking_menu_photo_usage_delete AFTER DELETE ON menus BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_menu' AND ref_id = OLD.id; END;
CREATE TRIGGER booking_menu_photo_usage_insert AFTER INSERT ON menus BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_menu' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_menu', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;
CREATE TRIGGER booking_menu_photo_usage_update AFTER UPDATE ON menus BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_menu' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_menu', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;
CREATE TRIGGER booking_settings_photo_usage_delete AFTER DELETE ON booking_settings BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_settings' AND ref_id = OLD.id; END;
CREATE TRIGGER booking_settings_photo_usage_insert AFTER INSERT ON booking_settings BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_settings' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.store_photo_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_interior_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_interior_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_waiting_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_waiting_media_id IS NOT NULL AND 1; END;
CREATE TRIGGER booking_settings_photo_usage_update AFTER UPDATE ON booking_settings BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_settings' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.store_photo_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_interior_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_interior_media_id IS NOT NULL AND 1 UNION SELECT NEW.store_photo_waiting_media_id, 'booking_settings', NEW.id WHERE NEW.store_photo_waiting_media_id IS NOT NULL AND 1; END;
CREATE TRIGGER booking_staff_photo_usage_delete AFTER DELETE ON staff BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_staff' AND ref_id = OLD.id; END;
CREATE TRIGGER booking_staff_photo_usage_insert AFTER INSERT ON staff BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_staff' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_staff', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;
CREATE TRIGGER booking_staff_photo_usage_update AFTER UPDATE ON staff BEGIN DELETE FROM media_usages WHERE ref_kind = 'booking_staff' AND ref_id = NEW.id; INSERT INTO media_usages(media_id,ref_kind,ref_id) SELECT NEW.photo_media_id, 'booking_staff', NEW.id WHERE NEW.photo_media_id IS NOT NULL AND NEW.deleted_at IS NULL; END;

-- 既存の使用先の埋め直しは、件数を区切って再開する定期走査で行う。
