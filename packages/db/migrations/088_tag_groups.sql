-- タグの親グループ。「お悩み」「ペット」「会員」のような分類でタグをまとめる。
-- tags には分類を表す列が無く、名前の付け方で運用するしかなかった。
--
-- tags に group 列を足すのではなく別表にしたのは、グループ自体が
-- 並び順を持ち、あとから名前を変えても紐づけが切れないようにするため。
CREATE TABLE IF NOT EXISTS tag_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tag_groups_sort ON tag_groups(sort_order, id);

-- 未分類のタグは group_id が NULL のまま。既存のタグは触らない。
ALTER TABLE tags ADD COLUMN group_id TEXT REFERENCES tag_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tags_group ON tags(group_id, name);
