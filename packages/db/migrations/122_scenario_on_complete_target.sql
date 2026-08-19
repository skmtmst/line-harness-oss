-- on_complete_mode = 'move' のときの移動先。
ALTER TABLE scenarios ADD COLUMN on_complete_scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL;
