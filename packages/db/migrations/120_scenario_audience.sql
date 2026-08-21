-- シナリオ全体の配信対象。Lステップの「対象の絞り込み」にあたる。
-- 条件ビルダーの結果 (SegmentCondition) をそのまま入れる。NULL は条件なし。
ALTER TABLE scenarios ADD COLUMN audience_condition_json TEXT;
