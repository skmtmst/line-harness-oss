-- 下書き。1 なら配信の対象から外す。書きかけを保存しておくため。
ALTER TABLE scenario_steps ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;
