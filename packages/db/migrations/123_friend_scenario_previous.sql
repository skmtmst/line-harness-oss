-- 「1つ前のシナリオを再開」のために、割り込む直前に読んでいたシナリオを控える。
-- 割り込みシナリオを購読させた側が書き、完了時に読んで戻す。
ALTER TABLE friend_scenarios ADD COLUMN previous_scenario_id TEXT;
