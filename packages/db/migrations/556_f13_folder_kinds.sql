-- migration-policy: table-rebuild
--
-- F-13（自動化と外部連携）の置き場の種類を増やす。'common_action'、
-- 'webhook'、'conversion' の3つを足す。'automation' は前からある。
--
-- `folders.kind` は CHECK なので、値を足すだけでも表を作り直すしかない
-- （150 のやり方をなぞる）。落とすのと改名するのは同じファイルに書く。
-- 分けると、その間に止まったときに `folders` が存在しない状態で残る。
--
-- 中身（自動化・共通操作・webhook・変換）の `folder_id` 列はまだ無い。
-- 箱の種類だけ先に足し、中身のひも付けと件数は別 lemma でやる。
-- それまでは件数は「数えていない」（#730）で返る。
--
-- ついでに直るもの: 'friend_field' は code（folders.ts）に前からあるのに
-- CHECK には入っていなかった。今回の作り直しで code と一致する。
--
-- 中身は全部引き継ぐ（account_id・color を含む9列を全部写す）。
-- 適用はしないこと（PR 本文に番号だけ書く）。
CREATE TABLE folders_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route','broadcast',
                  'friend_field','common_action','webhook','conversion')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  color         TEXT,
  account_id    TEXT REFERENCES line_accounts(id) ON DELETE CASCADE
);

INSERT INTO folders_new (id, kind, name, parent_id, display_order, created_at, updated_at, color, account_id)
SELECT id, kind, name, parent_id, display_order, created_at, updated_at, color, account_id FROM folders;

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;

-- 索引を貼り直す。名前は毎回変えること（150 の注意書き）。
-- 落とす前の状態を見て「もうある」と判断されると飛ばされて戻らない（136）。
CREATE INDEX IF NOT EXISTS idx_folders_kind_order_556 ON folders(kind, display_order);

-- 333 の索引は表と一緒に消えるので、同じ中身で貼り直す。
CREATE INDEX IF NOT EXISTS idx_folders_webinar_account_order_556
  ON folders(kind, account_id, display_order, name);
