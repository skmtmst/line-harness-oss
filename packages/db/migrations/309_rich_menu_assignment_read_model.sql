-- リッチメニューの個別割当について、現在値と実行履歴を分けて保存する。
-- LINE は全友だちの現在値を一覧で返さないため、この台帳を開始する前の割当は
-- 推測で補わない。API はその点を partial として運用者へ伝える。

CREATE TABLE IF NOT EXISTS rich_menu_assignments (
  id                 TEXT PRIMARY KEY,
  friend_id          TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  group_id           TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  version_id         TEXT,
  line_richmenu_id   TEXT NOT NULL,
  reason_kind        TEXT NOT NULL,
  reason_event_id    TEXT,
  assigned_at        TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (line_account_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_assignments_group
  ON rich_menu_assignments (line_account_id, group_id);

CREATE TABLE IF NOT EXISTS rich_menu_assignment_runs (
  id                     TEXT PRIMARY KEY,
  version_id             TEXT,
  friend_id              TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id        TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  group_id               TEXT REFERENCES rich_menu_groups(id) ON DELETE SET NULL,
  source_event_id        TEXT,
  idempotency_key        TEXT NOT NULL,
  previous_assignment_id TEXT,
  operation              TEXT NOT NULL CHECK (operation IN ('link', 'unlink')),
  status                 TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  attempt_count          INTEGER NOT NULL DEFAULT 1,
  next_retry_at          TEXT,
  last_error_code        TEXT,
  started_at             TEXT NOT NULL,
  completed_at           TEXT,
  UNIQUE (line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_assignment_runs_monthly
  ON rich_menu_assignment_runs (line_account_id, group_id, status, completed_at, friend_id);
