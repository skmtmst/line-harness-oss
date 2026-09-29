-- 回答ごとの友だち情報欄への書き込み結果を、後から推測せず表示する。
-- 既存回答は当時の結果を復元できないため unknown のままにする。
ALTER TABLE form_submissions
  ADD COLUMN destination_write_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (destination_write_status IN ('pending', 'succeeded', 'partial', 'failed', 'not_requested', 'unknown'));

ALTER TABLE form_submissions
  ADD COLUMN destination_write_attempted INTEGER;

ALTER TABLE form_submissions
  ADD COLUMN destination_write_succeeded INTEGER;

ALTER TABLE form_submissions
  ADD COLUMN destination_write_failed INTEGER;

ALTER TABLE form_submissions
  ADD COLUMN destination_write_completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_write_status
  ON form_submissions(form_id, destination_write_status, created_at DESC);
