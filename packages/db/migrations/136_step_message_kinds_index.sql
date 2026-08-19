-- 作り直しで索引が落ちるので、貼り直す。
CREATE INDEX IF NOT EXISTS idx_scenario_steps_scenario_id ON scenario_steps (scenario_id);
