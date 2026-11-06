-- V8「トークを開いたとき メニューを開いておく / 閉じておく」の保存先。
-- LINE のリッチメニュー作成payload `selected`（トーク画面を開いたときに
-- メニューを出した状態にするか）に対応する。0 = 閉じておく（従来どおり）、
-- 1 = 開いておく。既存行は 0 で今までの挙動（selected: false）を保つ。
ALTER TABLE rich_menu_groups ADD COLUMN default_open INTEGER NOT NULL DEFAULT 0;
