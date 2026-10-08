-- 統括のひな形・一括配信・友だち追加時配信のフォルダに色を追加。既存行は色なし。
ALTER TABLE hq_template_folders ADD COLUMN color TEXT
  CHECK (color IS NULL OR (typeof(color) = 'text' AND length(color) = 7 AND color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'));
ALTER TABLE hq_broadcast_folders ADD COLUMN color TEXT
  CHECK (color IS NULL OR (typeof(color) = 'text' AND length(color) = 7 AND color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'));
ALTER TABLE friend_add_rule_folders ADD COLUMN color TEXT
  CHECK (color IS NULL OR (typeof(color) = 'text' AND length(color) = 7 AND color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'));
