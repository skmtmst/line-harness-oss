-- 友だち一覧の保存検索と、配信に使う共通SegmentConditionを同じJSONとして
-- 推測で読み分けない。既存行はすべて従来形式として残す。
ALTER TABLE saved_searches
  ADD COLUMN condition_format TEXT NOT NULL DEFAULT 'search_v1'
  CHECK (condition_format IN ('search_v1','segment_v1'));

CREATE INDEX IF NOT EXISTS idx_saved_searches_account_format
  ON saved_searches(line_account_id, scope, condition_format, created_by, display_order);
