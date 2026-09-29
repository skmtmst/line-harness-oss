-- リッチメニューの公開日時と終了後の戻し先。
-- 予約時点の定義を写し、あとで下書きを編集しても予約内容を変えない。

CREATE TABLE IF NOT EXISTS rich_menu_schedules (
  id                    TEXT PRIMARY KEY,
  group_id              TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode                  TEXT NOT NULL CHECK (mode IN ('scheduled', 'period')),
  starts_at             TEXT NOT NULL,
  ends_at               TEXT,
  restore_group_id      TEXT REFERENCES rich_menu_groups(id) ON DELETE SET NULL,
  definition_snapshot   TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'publishing', 'published', 'restoring', 'completed', 'cancelled', 'failed')),
  idempotency_key       TEXT NOT NULL,
  requested_by_staff_id TEXT NOT NULL,
  started_run_id        TEXT,
  ended_run_id          TEXT,
  last_error_code       TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK (mode = 'scheduled' OR ends_at IS NOT NULL),
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_schedules_due
  ON rich_menu_schedules (status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_rich_menu_schedules_group
  ON rich_menu_schedules (group_id, created_at DESC);
