-- オーナー承認 2026-10-10 / PLAN §2: 共通固定欄＋予約の注意の写し。
-- migration-policy: table-rebuild
CREATE TABLE friend_fixed_fields_new (
 fixed_key TEXT PRIMARY KEY CHECK(fixed_key IN('name','kana','birthday','age','email','tel','address','allergy','anniversary','seat_preference')),
 field_id TEXT NOT NULL UNIQUE REFERENCES friend_fields(id) ON DELETE RESTRICT
);
INSERT INTO friend_fixed_fields_new SELECT * FROM friend_fixed_fields;
-- この表を参照する定義保護のトリガーは再作成する。
DROP TRIGGER fixed_friend_field_definition_guard;
DROP TABLE friend_fixed_fields;
ALTER TABLE friend_fixed_fields_new RENAME TO friend_fixed_fields;
INSERT INTO friend_fields(id,name,field_key,type,source,is_personal,display_order) VALUES
 ('fixed-allergy','アレルギー','fixed_allergy','text','form',1,0),
 ('fixed-anniversary','記念日','fixed_anniversary','date','form',1,1),
 ('fixed-seat_preference','席の好み','fixed_seat_preference','text','form',1,2);
INSERT INTO friend_fixed_fields VALUES('allergy','fixed-allergy'),('anniversary','fixed-anniversary'),('seat_preference','fixed-seat_preference');
CREATE TRIGGER fixed_friend_field_definition_guard BEFORE UPDATE ON friend_fields WHEN EXISTS(SELECT 1 FROM friend_fixed_fields WHERE field_id=OLD.id) AND (NEW.name IS NOT OLD.name OR NEW.field_key IS NOT OLD.field_key OR NEW.type IS NOT OLD.type OR NEW.type_v6 IS NOT OLD.type_v6 OR NEW.type_v8 IS NOT OLD.type_v8 OR NEW.folder_id IS NOT NULL OR NEW.is_personal<>1 OR NEW.ec_is_master<>0 OR NEW.status<>'active') BEGIN SELECT RAISE(ABORT,'FIXED_FRIEND_FIELD_IMMUTABLE'); END;
ALTER TABLE rt_reservations ADD COLUMN dining_snapshot_json TEXT CHECK(dining_snapshot_json IS NULL OR json_valid(dining_snapshot_json));
-- 過去の予約に現在の友だち情報を遡って写さない。既存の予約の注意だけを保持。
UPDATE rt_reservations SET dining_snapshot_json=json_object('allergy',allergy_note,'anniversary',NULL,'seatPreference',NULL,'courseId',course_id,'capturedAt',created_at);
CREATE TRIGGER rt_dining_snapshot_insert AFTER INSERT ON rt_reservations WHEN NEW.dining_snapshot_json IS NULL BEGIN UPDATE rt_reservations SET dining_snapshot_json=json_object( 'allergy',COALESCE(NEW.allergy_note,(SELECT v.value FROM friend_field_values v JOIN friends f ON f.id=v.friend_id JOIN rt_stores s ON s.line_account_id=f.line_account_id WHERE s.id=NEW.store_id AND f.line_user_id=NEW.line_uid AND v.field_id='fixed-allergy' LIMIT 1)), 'anniversary',(SELECT v.value FROM friend_field_values v JOIN friends f ON f.id=v.friend_id JOIN rt_stores s ON s.line_account_id=f.line_account_id WHERE s.id=NEW.store_id AND f.line_user_id=NEW.line_uid AND v.field_id='fixed-anniversary' LIMIT 1), 'seatPreference',(SELECT v.value FROM friend_field_values v JOIN friends f ON f.id=v.friend_id JOIN rt_stores s ON s.line_account_id=f.line_account_id WHERE s.id=NEW.store_id AND f.line_user_id=NEW.line_uid AND v.field_id='fixed-seat_preference' LIMIT 1), 'courseId',NEW.course_id,'courseAllergens',json(COALESCE((SELECT allergens_json FROM rt_menu_items WHERE id=NEW.course_id AND store_id=NEW.store_id),'[]')),'capturedAt',NEW.created_at) WHERE id=NEW.id; END;
