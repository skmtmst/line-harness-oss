-- m22w 監査 R373：交換したときの名前・種類を交換の行に凍結する。
--
-- これまで配送計画・履歴の表示は親行の名前・種類をその都度読んでいた。
-- 未公開の下書き保存が親行を書き換えるため、公開前の名前・種類の変更が
-- 処理中・成功済みの交換へ混ざっていた(R373)。
-- 交換の確定時にこの列へ凍結し、配送と表示は凍結値を優先する。
--
-- 付け足すだけ(ADD COLUMN)。既存の行はすべて NULL のままで、
-- NULL の行は従来どおり親行の現在値を読む(今の動きを変えない)。
ALTER TABLE mileage_redemptions ADD COLUMN reward_name_snapshot TEXT;
ALTER TABLE mileage_redemptions ADD COLUMN reward_kind_snapshot TEXT;
