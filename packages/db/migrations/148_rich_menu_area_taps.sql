-- リッチメニューのボタンが押された記録。
--
-- これまで「どのボタンが何回押されたか」を数えていなかった。一覧の
-- 「今月のタップ」「最多タップ」が「—」のままだったのはそのため。
-- 押されたボタンが分かるようになった（147）ので、1回ごとに1行残す。
--
-- **外部キーを張らない。** ボタンやページを消したときに記録まで消えると、
-- 「先月いちばん押されていたボタン」が振り返れなくなる。数えた事実は、
-- 数えた対象が無くなっても残すべきもの。
--
-- 同じ理由で、押された時点のボタン名を area_label に写しておく。
-- あとでボタンを消しても、集計に名前が出る。
CREATE TABLE IF NOT EXISTS rich_menu_area_taps (
  id              TEXT PRIMARY KEY,
  area_id         TEXT NOT NULL,
  page_id         TEXT NOT NULL,
  group_id        TEXT NOT NULL,
  area_label      TEXT,
  friend_id       TEXT,
  line_account_id TEXT,
  tapped_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 一覧の集計（このアカウントの、この期間）で使う。
CREATE INDEX IF NOT EXISTS idx_rich_menu_area_taps_group ON rich_menu_area_taps(group_id, tapped_at);
-- 編集画面のボタンごとの数で使う。
CREATE INDEX IF NOT EXISTS idx_rich_menu_area_taps_area ON rich_menu_area_taps(area_id, tapped_at);
