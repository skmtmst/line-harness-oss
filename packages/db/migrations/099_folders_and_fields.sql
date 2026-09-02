-- 汎用フォルダと友だち情報欄。
--
-- フォルダは13画面すべてに出る。いまは tag_groups（タグ専用）しかなく、
-- 画面ごとに別テーブルを足すと同じものが13個できる。

CREATE TABLE IF NOT EXISTS folders (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_folders_kind ON folders(kind, display_order);

ALTER TABLE templates ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE templates ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenarios ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE scenarios ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_replies ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE auto_replies ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reminders ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE tags ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

-- tag_groups からの移送。
--
-- 二重管理を避けるため folders を正とする。tag_groups と tags.group_id は
-- 消さずに残すが、以後どこからも読まない・書かない（追加のみポリシーで
-- 列は落とせないため、残すしかない）。
--
-- 切り戻すときは folders の kind='tag' の行を消せば元の状態に戻る。
INSERT OR IGNORE INTO folders (id, kind, name, display_order, created_at, updated_at)
  SELECT id, 'tag', name, sort_order, created_at, updated_at FROM tag_groups;

UPDATE tags SET folder_id = group_id WHERE group_id IS NOT NULL AND folder_id IS NULL;

-- 友だち情報欄。
--
-- フォームの回答 → 情報欄 → 友だち詳細 → テンプレートの差し込み、が
-- 1本の線で繋がる。この線の起点。
CREATE TABLE IF NOT EXISTS friend_fields (
  id             TEXT PRIMARY KEY,
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  -- 差し込み変数名。{pet_name} のように使うので、日本語・記号は入れない。
  -- 形の検証はAPI側（^[a-z][a-z0-9_]{0,31}$）。
  field_key      TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL CHECK (type IN (
                   'text','textarea','number','date','select',
                   'multi_select','checkbox','url','tel','email')),
  options_json   TEXT CHECK (options_json IS NULL OR json_valid(options_json)),
  default_value  TEXT,
  source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual','form','ec','automation')),
  -- EC連携時のマッピング元。ec_is_master が1なら EC 側を正とし、
  -- 管理画面からは書き換えさせない。
  ec_field_path  TEXT,
  ec_is_master   INTEGER NOT NULL DEFAULT 0,
  -- 本名・電話・住所など。閲覧を役割で絞り、開いたら記録を残す。
  is_personal    INTEGER NOT NULL DEFAULT 0,
  is_starred     INTEGER NOT NULL DEFAULT 0,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_friend_fields_order ON friend_fields(display_order, id);

CREATE TABLE IF NOT EXISTS friend_field_values (
  friend_id   TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  field_id    TEXT NOT NULL REFERENCES friend_fields(id) ON DELETE CASCADE,
  value       TEXT,
  -- staff.id / 'form' / 'ec' / 'automation'。誰が入れた値かで扱いが変わる。
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (friend_id, field_id)
);
-- 「この項目がこの値の人」で絞る検索が主用途。
CREATE INDEX IF NOT EXISTS idx_ffv_field ON friend_field_values(field_id, value);
