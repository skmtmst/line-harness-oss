-- 作り直しで索引が落ちるので、貼り直す。
--
-- **名前を変えてある。** 元の idx_scenario_steps_scenario_id のままだと、
-- 適用の要否を「いま索引があるか」で判定する仕組みが「もうある」と見て
-- **この行を飛ばす**。ところが 134 で表ごと落としているので、飛ばされると
-- 索引が消えたまま戻らない。
--
-- 判定を変えるより、名前を変えるほうが確実。消えた古い名前は誰も参照しない。
CREATE INDEX IF NOT EXISTS idx_scenario_steps_by_scenario ON scenario_steps (scenario_id);
