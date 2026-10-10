-- オーナー承認 2026-10-10: 固定7欄の対応だけを追加する。
-- 回答の値・出どころ・日時は friend_field_values の既存列を使う。
CREATE TABLE friend_fixed_fields (
  fixed_key TEXT PRIMARY KEY CHECK (fixed_key IN ('name','kana','birthday','age','email','tel','address')),
  field_id TEXT NOT NULL UNIQUE REFERENCES friend_fields(id) ON DELETE RESTRICT
);

INSERT INTO friend_fields (id, name, field_key, type, source, is_personal, display_order)
VALUES
  ('fixed-name', '名前', 'fixed_name', 'text', 'form', 1, -7),
  ('fixed-kana', 'ふりがな', 'fixed_kana', 'text', 'form', 1, -6),
  ('fixed-birthday', '生年月日', 'fixed_birthday', 'date', 'form', 1, -5),
  ('fixed-age', '年齢', 'fixed_age', 'number', 'form', 1, -4),
  ('fixed-email', 'メール', 'fixed_email', 'email', 'form', 1, -3),
  ('fixed-tel', '電話', 'fixed_tel', 'tel', 'form', 1, -2),
  ('fixed-address', '住所', 'fixed_address', 'textarea', 'form', 1, -1);
INSERT INTO friend_fixed_fields (fixed_key, field_id) VALUES
  ('name','fixed-name'), ('kana','fixed-kana'), ('birthday','fixed-birthday'),
  ('age','fixed-age'), ('email','fixed-email'), ('tel','fixed-tel'), ('address','fixed-address');

-- 名前は本名と同じ値。既存の本名も保持する。
INSERT INTO friend_field_values (friend_id, field_id, value, updated_by, updated_at)
SELECT id, 'fixed-name', real_name, 'manual', updated_at FROM friends
WHERE real_name IS NOT NULL AND TRIM(real_name) <> '';

CREATE TRIGGER fixed_name_value_insert AFTER INSERT ON friend_field_values
WHEN NEW.field_id = 'fixed-name'
BEGIN   UPDATE friends SET real_name = NEW.value, updated_at = NEW.updated_at
  WHERE id = NEW.friend_id AND real_name IS NOT NEW.value; END;
CREATE TRIGGER fixed_name_value_update AFTER UPDATE OF value ON friend_field_values
WHEN NEW.field_id = 'fixed-name'
BEGIN   UPDATE friends SET real_name = NEW.value, updated_at = NEW.updated_at
  WHERE id = NEW.friend_id AND real_name IS NOT NEW.value; END;
CREATE TRIGGER fixed_name_value_delete AFTER DELETE ON friend_field_values
WHEN OLD.field_id = 'fixed-name'
BEGIN   UPDATE friends SET real_name = NULL WHERE id = OLD.friend_id AND real_name IS NOT NULL; END;
CREATE TRIGGER fixed_name_friend_insert AFTER INSERT ON friends
WHEN NEW.real_name IS NOT NULL AND TRIM(NEW.real_name) <> ''
BEGIN   INSERT INTO friend_field_values (friend_id, field_id, value, updated_by, updated_at)
  VALUES (NEW.id, 'fixed-name', NEW.real_name, 'manual', NEW.updated_at); END;
CREATE TRIGGER fixed_name_friend_update AFTER UPDATE OF real_name ON friends
WHEN OLD.real_name IS NOT NEW.real_name
BEGIN   DELETE FROM friend_field_values WHERE friend_id = NEW.id AND field_id = 'fixed-name'
    AND (NEW.real_name IS NULL OR TRIM(NEW.real_name) = '');   INSERT INTO friend_field_values (friend_id, field_id, value, updated_by, updated_at, source_type, source_id)
  SELECT NEW.id, 'fixed-name', NEW.real_name, 'manual', NEW.updated_at, NULL, NULL
  WHERE NEW.real_name IS NOT NULL AND TRIM(NEW.real_name) <> ''
  ON CONFLICT(friend_id, field_id) DO UPDATE SET value = excluded.value,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at, source_type = NULL, source_id = NULL
  WHERE friend_field_values.value IS NOT excluded.value; END;

-- 手動・EC・自動化で上書きされた値を「フォームから」と誤表示しない。
CREATE TRIGGER friend_field_value_source_clear AFTER UPDATE OF value, updated_by, updated_at ON friend_field_values
WHEN NEW.updated_by IS NOT 'form' AND NEW.source_type = 'form'
BEGIN   UPDATE friend_field_values SET source_type = NULL, source_id = NULL
  WHERE friend_id = NEW.friend_id AND field_id = NEW.field_id; END;

CREATE TRIGGER fixed_friend_field_definition_guard BEFORE UPDATE ON friend_fields
WHEN EXISTS (SELECT 1 FROM friend_fixed_fields WHERE field_id = OLD.id)
  AND (NEW.name IS NOT OLD.name OR NEW.field_key IS NOT OLD.field_key
    OR NEW.type IS NOT OLD.type OR NEW.type_v6 IS NOT OLD.type_v6 OR NEW.type_v8 IS NOT OLD.type_v8
    OR NEW.folder_id IS NOT NULL OR NEW.is_personal <> 1 OR NEW.ec_is_master <> 0 OR NEW.status <> 'active')
BEGIN SELECT RAISE(ABORT, 'FIXED_FRIEND_FIELD_IMMUTABLE'); END;
