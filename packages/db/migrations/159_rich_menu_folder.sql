-- リッチメニューをフォルダで分けられるようにする。
--
-- 一覧に「フォルダを追加」のボタンがあるが押せない。列が無かったため。
-- 自動応答・一斉配信・シナリオ・タグは既に folder_id を持っていて、
-- リッチメニューだけ取り残されていた。
--
-- folders の kind には 'rich_menu' が最初から入っているので、箱そのものの
-- 作り直しは要らない。
ALTER TABLE rich_menu_groups ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
