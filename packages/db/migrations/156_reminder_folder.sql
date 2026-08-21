-- リマインダをフォルダで分けられるようにする。
--
-- 画面には前から「フォルダを追加」ボタンが押せない状態で置いてあり、
-- 一覧の帯には `['すべて','01_誕生日','02_定期便','未分類']` という
-- **べた書きの名前**が並んでいた。実データではないので、押しても何も起きない。
--
-- タグ・シナリオ・一斉配信・共通情報は同じ仕組みで分けられるのに、
-- リマインダだけ「すべて」しか無い状態だった。
--
-- `folders.kind` には 150 で作り直したときから 'reminder' が入っているので、
-- ここで足すのは `reminders.folder_id` だけでよい。表の作り直しは要らない。
--
-- フォルダを消したときは未分類に戻す（ON DELETE SET NULL）。
-- リマインダごと消えると、動いている配信が黙って止まる。
ALTER TABLE reminders ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_folder ON reminders(folder_id);
