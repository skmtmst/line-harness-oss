-- 保存した検索の使用先を固定表示ではなく実データで確認する。
-- ON DELETE RESTRICT は、画面を通さない削除でも参照中の定義を守る。
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_searches_id_account
  ON saved_searches(id, line_account_id);

CREATE TABLE IF NOT EXISTS saved_search_references (
  saved_search_id TEXT NOT NULL,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  reference_kind TEXT NOT NULL
    CHECK (reference_kind IN ('broadcast','automation','scenario','other')),
  reference_id TEXT NOT NULL,
  reference_name TEXT NOT NULL,
  reference_mode TEXT NOT NULL DEFAULT 'live'
    CHECK (reference_mode IN ('live','fixed')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (saved_search_id, reference_kind, reference_id),
  FOREIGN KEY (saved_search_id, line_account_id)
    REFERENCES saved_searches(id, line_account_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_saved_search_references_account
  ON saved_search_references(line_account_id, saved_search_id, reference_kind);
