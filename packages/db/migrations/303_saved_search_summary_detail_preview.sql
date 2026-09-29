-- 保存した検索の一覧集計・詳細・事前確認を、固定値ではなく実データで返す。
-- 条件の同時更新を後勝ちにしないため現在版と履歴も持つ。
ALTER TABLE saved_searches ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
  CHECK (revision >= 1);
ALTER TABLE saved_searches ADD COLUMN updated_by TEXT;
ALTER TABLE saved_searches ADD COLUMN updated_at TEXT;

UPDATE saved_searches
   SET updated_by = COALESCE(updated_by, created_by),
       updated_at = COALESCE(updated_at, created_at);

CREATE TABLE IF NOT EXISTS saved_search_revisions (
  saved_search_id TEXT NOT NULL,
  line_account_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  name TEXT NOT NULL,
  conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json)),
  is_shared INTEGER NOT NULL CHECK (is_shared IN (0, 1)),
  display_order INTEGER NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (saved_search_id, revision),
  FOREIGN KEY (saved_search_id, line_account_id)
    REFERENCES saved_searches(id, line_account_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO saved_search_revisions
  (saved_search_id, line_account_id, revision, name, conditions_json,
   is_shared, display_order, updated_by, created_at)
SELECT id, line_account_id, revision, name, conditions_json,
       is_shared, display_order, updated_by, COALESCE(updated_at, created_at)
  FROM saved_searches;

ALTER TABLE saved_search_references ADD COLUMN revision INTEGER;

UPDATE saved_search_references
   SET revision = COALESCE(
     revision,
     (SELECT revision FROM saved_searches
       WHERE saved_searches.id = saved_search_references.saved_search_id
         AND saved_searches.line_account_id = saved_search_references.line_account_id)
   );

CREATE TABLE IF NOT EXISTS saved_search_usage_events (
  id TEXT PRIMARY KEY,
  saved_search_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  reference_kind TEXT NOT NULL
    CHECK (reference_kind IN ('friends','broadcast','automation','scenario','other')),
  reference_id TEXT,
  used_by TEXT,
  used_at TEXT NOT NULL,
  FOREIGN KEY (saved_search_id, line_account_id)
    REFERENCES saved_searches(id, line_account_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_saved_search_usage_month
  ON saved_search_usage_events(line_account_id, saved_search_id, used_at);

CREATE INDEX IF NOT EXISTS idx_saved_search_usage_reference
  ON saved_search_usage_events(
    line_account_id, saved_search_id, reference_kind, reference_id, used_at
  );
