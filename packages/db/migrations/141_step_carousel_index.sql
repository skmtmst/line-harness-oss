-- 索引を貼り直す。
--
-- **名前を毎回変えること。** 適用の要否を「いま索引があるか」で判定する
-- 仕組みは、表を落とす前の状態を見て「もうある」と判断し、この行を飛ばす。
-- 飛ばされると索引が消えたまま戻らない（136 で実際に踏んだ）。
--
-- 次に scenario_steps を作り直すときも、必ず新しい名前にすること。
CREATE INDEX IF NOT EXISTS idx_scenario_steps_scenario_lookup ON scenario_steps (scenario_id);
