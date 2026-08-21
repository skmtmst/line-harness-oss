-- migration-policy: table-rebuild
--
-- 一斉配信をフォルダで分けられるようにする。あわせて開封数を取るかどうかを持つ。
--
-- 画面には前から「フォルダを追加」ボタンがあるが、押せないまま置いてあった
-- （`broadcasts` に `folder_id` が無く、`folders.kind` に 'broadcast' も無い）。
-- タグ・シナリオ・リマインダは同じ仕組みで分けられるのに、一斉配信だけ
-- 「すべて」しか無い状態だった。
--
-- 開封数は、LINE の集計ユニットが**アカウントあたり月1,000**までなので、
-- 全部の配信で取ると上限に当たる。取るかどうかを配信ごとに選べるようにする。
-- 既定は「取る」（いままでの挙動）。
--
-- `folders.kind` は CHECK なので、値を1つ増やすだけでも表を作り直すしかない。
-- 落とすのと改名するのは同じファイルに書く。分けると、その間に止まったときに
-- `folders` が存在しない状態で残る（当てる仕組みはファイルごとに実行する）。
CREATE TABLE folders_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route','broadcast')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  color         TEXT
);

INSERT INTO folders_new (id, kind, name, parent_id, display_order, created_at, updated_at, color)
SELECT id, kind, name, parent_id, display_order, created_at, updated_at, color FROM folders;

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;

-- 索引を貼り直す。
--
-- **名前を毎回変えること。** 適用の要否を「いま索引があるか」で判定する
-- 仕組みは、表を落とす前の状態を見て「もうある」と判断してこの行を飛ばす。
-- 飛ばされると索引が消えたまま戻らない（136 で実際に踏んだ）。
--
-- 次に folders を作り直すときも、必ず新しい名前にすること。
CREATE INDEX IF NOT EXISTS idx_folders_kind_order ON folders(kind, display_order);

ALTER TABLE broadcasts ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

-- 開封数を取るか。1 = 取る（いままでどおり）。
ALTER TABLE broadcasts ADD COLUMN measure_opens INTEGER NOT NULL DEFAULT 1;
