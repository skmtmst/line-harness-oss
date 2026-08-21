-- 発火のたびに hook で引くので、その形の索引を置く。
CREATE INDEX IF NOT EXISTS idx_scenario_actions_lookup
  ON scenario_actions (scenario_id, hook, step_id, choice_index, sort_order);
