-- 草稿：D1へは適用しない。
-- 工程ごとの完了日時を保存する。過去の工程は日時を推測して埋めない。
ALTER TABLE form_submit_claims ADD COLUMN step_completed_at_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(step_completed_at_json) AND json_type(step_completed_at_json) = 'object');
