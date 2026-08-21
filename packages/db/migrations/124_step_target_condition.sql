-- 1通ごとの配信対象。Lステップの「配信対象の絞り込み」にあたる。
-- 条件ビルダーの結果 (SegmentCondition)。NULL は「購読中の全員に配信する」。
--
-- 既にある condition_type / condition_value は「満たさなければ次へ飛ばす」
-- 分岐用で、意味が違う。こちらは「対象でなければこの通だけ送らない」。
ALTER TABLE scenario_steps ADD COLUMN target_condition_json TEXT;
