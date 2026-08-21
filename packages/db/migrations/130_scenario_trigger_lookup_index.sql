CREATE INDEX IF NOT EXISTS idx_scenario_triggers_lookup
  ON scenario_triggers (kind, tag_id);
