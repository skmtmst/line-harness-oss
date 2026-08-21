-- リッチメニューのボタンに「何をするボタンか」と、押されたときの追加動作を持たせる。
--
-- 背景。LINE のリッチメニューが持てる動きは uri / message / postback /
-- richmenuswitch の4つしかない。いっぽう運用の現場で欲しいのは「電話をかける」
-- 「テンプレートを送る」「回答フォームを開く」で、これらは LINE の4つの上に
-- 乗せた別の言い方でしかない（電話は uri の tel:、フォームは uri の LIFF、
-- テンプレートは postback を受けてこちらから送る）。
--
-- なので action_type の4つはそのまま残し、「運用者から見た意図」を intent に
-- 別で持つ。既にあるボタンは intent が空のままでも今までどおり動く。
--
-- あわせて、押した瞬間にタグを付けたりスコアを足したりできるようにする。
-- これは Lステップで定番の使い方で、押した人だけを後から絞り込める。
ALTER TABLE rich_menu_areas ADD COLUMN intent TEXT;
ALTER TABLE rich_menu_areas ADD COLUMN label TEXT;
ALTER TABLE rich_menu_areas ADD COLUMN tag_ids TEXT;
ALTER TABLE rich_menu_areas ADD COLUMN score_change INTEGER;
ALTER TABLE rich_menu_areas ADD COLUMN template_id TEXT;
ALTER TABLE rich_menu_areas ADD COLUMN form_id TEXT;
ALTER TABLE rich_menu_areas ADD COLUMN tracked_link_id TEXT;
