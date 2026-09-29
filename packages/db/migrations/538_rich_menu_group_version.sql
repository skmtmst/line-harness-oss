-- M950/M951: リッチメニュー編集の保存の版照合と原子確定のための版列。
--
-- 保存（PATCH）のたびに version を +1 し、古い画面からの保存は 409 で止める
-- （タグ編集の expectedVersion と同じ約束）。meta と pages は 1 batch で確定し、
-- pages が失敗したら meta も戻る。付け足すだけの列で、既存の列は触らない。
ALTER TABLE rich_menu_groups ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
