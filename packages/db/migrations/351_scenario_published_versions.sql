-- N-050: シナリオの下書きと公開版を分ける。稼働中の文面・順序を固定し、
-- 編集内容は次に公開する版へ分離する (#644)。
--
-- 流儀は自動応答の公開版 (273) と同じ。scenario_versions に不変の
-- スナップショットを残し、friend_scenarios は開始時の版へ固定する。
-- 既存の購読 (published_version_id NULL) は従来どおり live の表を読む。

CREATE TABLE IF NOT EXISTS scenario_versions (
  id                        TEXT PRIMARY KEY,
  scenario_id               TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  version_number            INTEGER NOT NULL,
  delivery_mode             TEXT NOT NULL DEFAULT 'relative',
  audience_condition_json   TEXT,
  on_complete_mode          TEXT NOT NULL DEFAULT 'pause',
  on_complete_scenario_id   TEXT,
  steps_snapshot            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(steps_snapshot)),
  status                    TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'retired')),
  published_at              TEXT NOT NULL,
  published_by_staff_id     TEXT,
  publish_idempotency_key   TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  UNIQUE (scenario_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scenario_versions_publish_key
  ON scenario_versions (publish_idempotency_key)
  WHERE publish_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scenario_versions_scenario
  ON scenario_versions (scenario_id, status, version_number DESC);

ALTER TABLE scenarios ADD COLUMN current_published_version_id TEXT;

ALTER TABLE friend_scenarios ADD COLUMN published_version_id TEXT;

CREATE INDEX IF NOT EXISTS idx_friend_scenarios_published_version
  ON friend_scenarios (published_version_id)
  WHERE published_version_id IS NOT NULL;

-- 既存シナリオのいまの下書きを公開版 1 として固定する。版が無いものだけ。
-- 通のスナップショットは step_order 順の JSON 配列にする。
INSERT OR IGNORE INTO scenario_versions (
  id, scenario_id, version_number, delivery_mode, audience_condition_json,
  on_complete_mode, on_complete_scenario_id, steps_snapshot,
  status, published_at, created_at, updated_at
)
SELECT
  'scenario-version-v1-' || s.id,
  s.id,
  1,
  s.delivery_mode,
  s.audience_condition_json,
  s.on_complete_mode,
  s.on_complete_scenario_id,
  COALESCE((
    SELECT json_group_array(json(step_json))
    FROM (
      SELECT json_object(
        'id', ss.id,
        'scenario_id', ss.scenario_id,
        'step_order', ss.step_order,
        'delay_minutes', ss.delay_minutes,
        'message_type', ss.message_type,
        'message_content', ss.message_content,
        'condition_type', ss.condition_type,
        'condition_value', ss.condition_value,
        'next_step_on_false', ss.next_step_on_false,
        'offset_days', ss.offset_days,
        'offset_minutes', ss.offset_minutes,
        'delivery_time', ss.delivery_time,
        'template_id', ss.template_id,
        'on_reach_tag_id', ss.on_reach_tag_id,
        'after_send', ss.after_send,
        'target_condition_json', ss.target_condition_json,
        'question_json', ss.question_json,
        'is_draft', ss.is_draft,
        'created_at', ss.created_at
      ) AS step_json
      FROM scenario_steps ss
      WHERE ss.scenario_id = s.id
      ORDER BY ss.step_order ASC
    )
  ), '[]'),
  'published',
  s.created_at,
  s.created_at,
  s.created_at
FROM scenarios s
WHERE NOT EXISTS (
  SELECT 1 FROM scenario_versions sv WHERE sv.scenario_id = s.id
);

UPDATE scenarios
SET current_published_version_id = 'scenario-version-v1-' || id
WHERE current_published_version_id IS NULL
  AND EXISTS (
    SELECT 1 FROM scenario_versions sv
    WHERE sv.scenario_id = scenarios.id
      AND sv.status = 'published'
  );

-- 公開済みの版は実行記録から参照されるため、本文を書き換えない。
CREATE TRIGGER IF NOT EXISTS trg_scenario_versions_immutable_update
BEFORE UPDATE OF scenario_id, version_number, delivery_mode, audience_condition_json,
  on_complete_mode, on_complete_scenario_id, steps_snapshot
ON scenario_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published scenario versions are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_scenario_versions_status_transition
BEFORE UPDATE OF status ON scenario_versions
WHEN OLD.status = 'published'
 AND NEW.status <> OLD.status
 AND NEW.status <> 'retired'
BEGIN SELECT RAISE(ABORT, 'published scenario version status cannot move backwards'); END;

CREATE TRIGGER IF NOT EXISTS trg_scenario_versions_immutable_delete
BEFORE DELETE ON scenario_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published scenario versions cannot be deleted'); END;
