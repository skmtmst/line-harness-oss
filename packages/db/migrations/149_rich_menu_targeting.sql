-- 友だちごとに出すメニューを切り替えるための条件。
--
-- これまでは「友だちに表示」から手で一括適用するしかなく、あとから条件に
-- 当てはまった人には出せなかった。タグが付いた時点で自動で切り替わるように、
-- メニューごとに条件を持たせる。
--
-- 条件の形は、一斉配信やシナリオで使っている絞り込みと**同じもの**を使う
-- （SegmentCondition の JSON）。リッチメニュー専用の条件言語を作ると、
-- 項目を増やすたびに2か所直すことになり、必ずどちらかがずれる。
--
-- 新しい表を作らず、メニューの表に列を足す。メニュー1つに条件1つで足りる
-- （条件そのものが「すべて満たす」「どれかを満たす」の入れ子を持てる）。
--
-- targeting_priority は、複数のメニューの条件に当てはまったときの順番。
-- 小さいほうが先に見られる。同じなら作った順。
ALTER TABLE rich_menu_groups ADD COLUMN targeting_condition TEXT;
ALTER TABLE rich_menu_groups ADD COLUMN targeting_priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rich_menu_groups ADD COLUMN targeting_enabled INTEGER NOT NULL DEFAULT 0;
