-- 実行開始時に共通アクションを展開し、その時点の版と順序を固定する。
-- 既存行はNULLのまま旧来の公開版定義を読むため、進行中データを壊さない。
ALTER TABLE automation_runs ADD COLUMN execution_plan_json TEXT;
