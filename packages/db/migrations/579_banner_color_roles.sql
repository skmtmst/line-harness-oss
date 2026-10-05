-- 統括の「バナー生成」の色の指定を4つの役割にする（承認済み ★BG-B `KkTNS`）。
--
-- 385 ではメイン・サブの2色だけだった。承認した画面はベース（背景）・
-- メイン（主役）・サブ（差し色）・強調（目立たせたい文字）の4つなので、
-- 足りない2列を足す。既にある main_color・sub_color はそのまま使う。
--
-- 移行前の行は NULL のまま（＝指定なし）。画面も NULL を「指定なし」として
-- 出すので、作り直しは要らない。値は `#RRGGBB` か、すけ具合つきの
-- `#RRGGBBAA` の文字（検査はアプリ側）。
ALTER TABLE banner_generations ADD COLUMN base_color TEXT;
ALTER TABLE banner_generations ADD COLUMN accent_color TEXT;
