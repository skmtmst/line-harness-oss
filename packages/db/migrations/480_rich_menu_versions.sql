-- K(#822): リッチメニューの版台帳。下書きと公開版を分けて残す。
-- 公開はこの版を凍結して実行し、公開中の定義行を直接書き換えない。
-- 取り消しは行を消さず、新しい版か archived への付け替えで表す。

CREATE TABLE IF NOT EXISTS rich_menu_versions (
  id                   TEXT PRIMARY KEY,
  group_id             TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  version_number       INTEGER NOT NULL CHECK (version_number >= 1),
  -- 公開を実行した時点の下書きの中身（ページ・領域・割当条件の写し）。
  definition_snapshot  TEXT NOT NULL,
  -- 下書きの要約と公開版の照合に使う。下書きが変わると変わる。
  definition_fingerprint TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_by_staff_id  TEXT,
  published_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rich_menu_versions_group_number
  ON rich_menu_versions(group_id, version_number);
CREATE INDEX IF NOT EXISTS idx_rich_menu_versions_group_status
  ON rich_menu_versions(group_id, status);
