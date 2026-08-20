-- リッチメニューを自分で並べ替えられるようにする。
--
-- 一覧に「並び替え」のボタンがあるが押せない。並び順を持つ列が無かったため。
-- 自動応答・シナリオ・タグは既に display_order を持っていて、リッチメニューだけ
-- 取り残されていた。
--
-- 既にあるメニューは 0。同じ値のときは、これまでどおり更新の新しい順に並ぶ。
ALTER TABLE rich_menu_groups ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
