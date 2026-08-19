-- シナリオのアクション。
--
-- Lステップの「アクション設定」にあたる。1通ごと・シナリオ完了時・質問の
-- 選択肢ごとの3か所から同じ形で呼ぶので、発火点を hook 列で持つ1つの表にする。
-- 種別ごとに表を分けると、並び順と条件を種別の数だけ書くことになる。
--
-- config_json / condition_json の形は services/scenario-actions.ts に書いてある。
CREATE TABLE IF NOT EXISTS scenario_actions (
  id               TEXT PRIMARY KEY,
  scenario_id      TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  -- どこで発火するか。
  --   step_sent          … その通を送ったあと
  --   scenario_completed … 最終コンテンツを配り終えたあと
  --   choice_selected    … 質問の選択肢が押されたとき
  hook             TEXT NOT NULL CHECK (hook IN ('step_sent', 'scenario_completed', 'choice_selected')),
  -- hook が step_sent / choice_selected のときだけ入る。
  step_id          TEXT REFERENCES scenario_steps (id) ON DELETE CASCADE,
  -- hook が choice_selected のときだけ入る。0 始まり。
  choice_index     INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  action_type      TEXT NOT NULL CHECK (action_type IN ('tag', 'friend_field', 'support_mark', 'scenario', 'common_var')),
  config_json      TEXT NOT NULL CHECK (json_valid(config_json)),
  -- 条件ビルダーの結果 (SegmentCondition)。NULL なら無条件。
  condition_json   TEXT CHECK (condition_json IS NULL OR json_valid(condition_json)),
  -- 0 なら、同じ友だちに対して1度しか実行しない。
  repeat_on_refire INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
