-- 対応マーク・表示状態・保存した検索。

CREATE TABLE IF NOT EXISTS support_marks (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#94A3B8',
  -- 新規友だちの初期値。1行だけ1にする（複数あってもアプリ側で最初の1件を使う）。
  is_default      INTEGER NOT NULL DEFAULT 0,
  -- 友だちから受信したとき自動でこれにする。
  auto_on_inbound INTEGER NOT NULL DEFAULT 0,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

ALTER TABLE friends ADD COLUMN support_mark_id TEXT REFERENCES support_marks(id) ON DELETE SET NULL;
-- こちらから非表示にした友だち。LINE公式アカウントに「運営側からブロック」は
-- 無いので自社で持つ。一斉配信の絞り込み「表示状態」がこれを見る。
ALTER TABLE friends ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
-- 本名。LINEの表示名とは別に持つ（表示名は本人がいつでも変えられる）。
ALTER TABLE friends ADD COLUMN real_name TEXT;
-- 管理画面だけで使う表示名。運用側が付ける呼び名。
ALTER TABLE friends ADD COLUMN system_display_name TEXT;
ALTER TABLE friends ADD COLUMN private_memo TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_mark ON friends(support_mark_id);
-- 一覧の既定が「表示中の人だけを新しい順」なので、そこまで索引で賄う。
CREATE INDEX IF NOT EXISTS idx_friends_hidden_created ON friends(is_hidden, created_at DESC);

-- 初期の3マーク。既存のチャット状態（unread / in_progress / resolved）と
-- 同じ意味にそろえてある。id を固定しているのは、入れ直しても増えないようにするため。
INSERT OR IGNORE INTO support_marks (id, name, color, is_default, auto_on_inbound, display_order) VALUES
  ('mark_untouched','未対応','#F59E0B',1,1,0),
  ('mark_working','対応中','#3B82F6',0,0,1),
  ('mark_done','解決済','#10B981',0,0,2);

CREATE TABLE IF NOT EXISTS saved_searches (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'friends'
                    CHECK (scope IN ('friends','chats','bookings')),
  -- { all: [...], any: [...], visibility: '...' } の形。AND群とOR群の2グループ。
  conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json)),
  created_by      TEXT,
  is_shared       INTEGER NOT NULL DEFAULT 1,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_scope ON saved_searches(scope, display_order);
