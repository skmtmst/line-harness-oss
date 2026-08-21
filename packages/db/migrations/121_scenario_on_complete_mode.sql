-- 最終コンテンツを配り終えたあとどうするか。
--   pause           … 止める（これまでと同じ）
--   resume_previous … 割り込む前に読んでいたシナリオへ戻す
--   move            … 別のシナリオへ移す
ALTER TABLE scenarios ADD COLUMN on_complete_mode TEXT NOT NULL DEFAULT 'pause';
