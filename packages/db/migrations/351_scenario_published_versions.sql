-- N-050: シナリオの下書きと公開版を分ける。稼働中の文面・順序を固定し、
-- 編集内容は次に公開する版へ分離する (#644)。
--
-- 流儀は自動応答の公開版 (273) と同じ。scenario_versions に不変の
-- スナップショットを残し、friend_scenarios は開始時の版へ固定する。
--
-- 版の持ち方:
-- - 通の正体は版所有の通ID (`<版ID>:<通番>`)。live の scenario_steps.id は
--   履歴づけの控え (live_step_id) としてだけ残し、配信の判断には使わない。
--   下書きの通を消しても、版の読み・配信ログ・二重送信防止が壊れない。
-- - template を使う通は、公開時に文面・質問を解決して写す。公開後の
--   template 編集は、固定済みの版の配信へ混入しない。
-- - 冪等キーは scenario_publish_keys 台帳に残す。同keyの再実行は同版を返し、
--   別内容・別シナリオでの使い回しは 409 (SCENARIO_PUBLISH_KEY_CONFLICT)。

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
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  UNIQUE (scenario_id, version_number)
);

CREATE TABLE IF NOT EXISTS scenario_publish_keys (
  publish_idempotency_key   TEXT PRIMARY KEY,
  scenario_id               TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  version_id                TEXT NOT NULL,
  content_snapshot          TEXT NOT NULL,
  created_at                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenario_versions_scenario
  ON scenario_versions (scenario_id, status, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_scenario_publish_keys_scenario
  ON scenario_publish_keys (scenario_id);

ALTER TABLE scenarios ADD COLUMN current_published_version_id TEXT;

-- 版への参照整合。版は消せない(トリガーで禁止)ので、購読が宙に浮かない。
-- 版より前の購読は下で v1 へ寄せる。新規購読は必ず版付きで作る。
ALTER TABLE friend_scenarios ADD COLUMN published_version_id TEXT REFERENCES scenario_versions (id);

CREATE INDEX IF NOT EXISTS idx_friend_scenarios_published_version
  ON friend_scenarios (published_version_id)
  WHERE published_version_id IS NOT NULL;

-- 配信ログに版所有の通IDを残す。二重送信防止の照合はこれで行い、
-- 下書きの通ID (scenario_step_id) が消えても照合が外れない。
-- scenario_step_id には live の通が残っているときだけ入れ、無いときは NULL
-- (外部キーを壊さない)。ダッシュボードの既存の集計は scenario_step_id を見る。
ALTER TABLE messages_log ADD COLUMN scenario_version_step_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_log_version_step
  ON messages_log (friend_id, scenario_version_step_id)
  WHERE scenario_version_step_id IS NOT NULL;

-- 既存シナリオのいまの下書きを公開版 1 として固定する。版が無いものだけ。
-- 通の写しは step_order 順の JSON 配列にする。template を使う通は、その時点の
-- 文面・質問を解決して写す (アプリ側の公開処理と同じ解決。無ければ通の控え)。
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
        'version_step_id', 'scenario-version-v1-' || s.id || ':' || ss.step_order,
        'step_order', ss.step_order,
        'delay_minutes', ss.delay_minutes,
        'message_type', COALESCE((SELECT t.message_type FROM templates t WHERE t.id = ss.template_id), ss.message_type),
        'message_content', COALESCE((SELECT t.message_content FROM templates t WHERE t.id = ss.template_id), ss.message_content),
        'condition_type', ss.condition_type,
        'condition_value', ss.condition_value,
        'next_step_on_false', ss.next_step_on_false,
        'offset_days', ss.offset_days,
        'offset_minutes', ss.offset_minutes,
        'delivery_time', ss.delivery_time,
        'template_id', ss.template_id,
        'template_id_at_send', CASE WHEN EXISTS (SELECT 1 FROM templates t WHERE t.id = ss.template_id) THEN ss.template_id ELSE NULL END,
        'on_reach_tag_id', ss.on_reach_tag_id,
        'after_send', ss.after_send,
        'target_condition_json', ss.target_condition_json,
        'question_json', COALESCE((SELECT t.question_json FROM templates t WHERE t.id = ss.template_id), ss.question_json),
        'is_draft', ss.is_draft,
        'live_step_id', ss.id,
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
SET current_published_version_id = (
  SELECT sv.id FROM scenario_versions sv
  WHERE sv.scenario_id = scenarios.id AND sv.status = 'published'
  ORDER BY sv.version_number DESC LIMIT 1
)
WHERE current_published_version_id IS NULL
  AND EXISTS (
    SELECT 1 FROM scenario_versions sv
    WHERE sv.scenario_id = scenarios.id
      AND sv.status = 'published'
  );

-- 既存の購読はすべて公開版 1 へ寄せる。版なし購読を live 読みに残さない。
-- 完了済みも含めて寄せる (配信はしないので害はなく、履歴の版がそろう)。
UPDATE friend_scenarios
SET published_version_id = (
  SELECT sv.id FROM scenario_versions sv
  WHERE sv.scenario_id = friend_scenarios.scenario_id
  ORDER BY sv.version_number ASC LIMIT 1
)
WHERE published_version_id IS NULL
  AND EXISTS (
    SELECT 1 FROM scenario_versions sv
    WHERE sv.scenario_id = friend_scenarios.scenario_id
  );

-- 公開済み・引退済みの版は実行記録から参照されるため、本文を書き換えない。
-- 273 (自動応答) と同じく retired も含めて不変にする。復帰・削除も不可。
CREATE TRIGGER IF NOT EXISTS trg_scenario_versions_immutable_update
BEFORE UPDATE OF scenario_id, version_number, delivery_mode, audience_condition_json,
  on_complete_mode, on_complete_scenario_id, steps_snapshot
ON scenario_versions
WHEN OLD.status IN ('published', 'retired')
BEGIN SELECT RAISE(ABORT, 'published scenario versions are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_scenario_versions_status_transition
BEFORE UPDATE OF status ON scenario_versions
WHEN OLD.status IN ('published', 'retired')
 AND NEW.status <> OLD.status
 AND NOT (OLD.status = 'published' AND NEW.status = 'retired')
BEGIN SELECT RAISE(ABORT, 'published scenario version status cannot move backwards'); END;

-- 版の削除は、親シナリオごと消えるときだけ通す。直接の DELETE は published /
-- retired を問わず止める。親が先に消える CASCADE の最中は EXISTS が偽になる
-- ので通り、単独の DELETE では親が残っているので止まる。
CREATE TRIGGER IF NOT EXISTS trg_scenario_versions_immutable_delete
BEFORE DELETE ON scenario_versions
WHEN OLD.status IN ('published', 'retired')
 AND EXISTS (SELECT 1 FROM scenarios WHERE id = OLD.scenario_id)
BEGIN SELECT RAISE(ABORT, 'published scenario versions cannot be deleted'); END;
