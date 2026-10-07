-- 草稿: オーナーの番号承認・適用承認までは D1 に適用しない。
-- 最後に配信を止めた記録。再開・通常の編集では消さない。
ALTER TABLE scenarios ADD COLUMN stopped_reason TEXT
  CHECK (stopped_reason IS NULL OR length(stopped_reason) <= 200);
ALTER TABLE scenarios ADD COLUMN stopped_by TEXT;
ALTER TABLE scenarios ADD COLUMN stopped_at TEXT;
