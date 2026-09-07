-- 機能5: 送信後アクション8種を公開設定へ保存する。
-- migration-policy: table-rebuild
CREATE TABLE scenario_actions_new (
  id               TEXT PRIMARY KEY,
  scenario_id      TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  hook             TEXT NOT NULL CHECK (hook IN ('step_sent', 'scenario_completed', 'choice_selected')),
  step_id          TEXT REFERENCES scenario_steps (id) ON DELETE CASCADE,
  choice_index     INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  action_type      TEXT NOT NULL CHECK (action_type IN ('tag', 'friend_field', 'support_mark', 'scenario', 'common_var', 'send_message', 'send_template', 'reminder', 'event_booking')),
  config_json      TEXT NOT NULL CHECK (json_valid(config_json)),
  condition_json   TEXT CHECK (condition_json IS NULL OR json_valid(condition_json)),
  repeat_on_refire INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
INSERT INTO scenario_actions_new (id, scenario_id, hook, step_id, choice_index, sort_order, action_type, config_json, condition_json, repeat_on_refire, created_at)
SELECT id, scenario_id, hook, step_id, choice_index, sort_order, action_type, config_json, condition_json, repeat_on_refire, created_at
FROM scenario_actions;
DROP TABLE scenario_actions;
ALTER TABLE scenario_actions_new RENAME TO scenario_actions;
CREATE INDEX IF NOT EXISTS idx_scenario_actions_lookup
  ON scenario_actions (scenario_id, hook, step_id, choice_index, sort_order);

CREATE TABLE scenario_triggers_new (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('friend_add', 'tag_added', 'form_answer', 'booking_confirmed')),
  tag_id TEXT REFERENCES tags (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
INSERT INTO scenario_triggers_new (id, scenario_id, kind, tag_id, created_at)
SELECT id, scenario_id, kind, tag_id, created_at FROM scenario_triggers;
DROP TABLE scenario_triggers;
ALTER TABLE scenario_triggers_new RENAME TO scenario_triggers;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scenario_triggers_unique
  ON scenario_triggers (scenario_id, kind, COALESCE(tag_id, ''));
CREATE INDEX IF NOT EXISTS idx_scenario_triggers_lookup ON scenario_triggers (kind, tag_id);
