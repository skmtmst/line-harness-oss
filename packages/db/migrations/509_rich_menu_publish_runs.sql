-- K(#822): 公開の実行台帳。版・実行・結果を1行に残す。
-- 実行の仕組み（lease・journal）は manual_publish_requests が担い、
-- この表は「いつ・どの版を・誰が・どうした」の見せるための記録。
-- 照合（reconcile）の実行と毎日の自動照合も同じ表に残す。

CREATE TABLE IF NOT EXISTS rich_menu_publish_runs (
  id                    TEXT PRIMARY KEY,
  group_id              TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  version_id            TEXT REFERENCES rich_menu_versions(id) ON DELETE SET NULL,
  idempotency_key       TEXT NOT NULL,
  mode                  TEXT NOT NULL
    CHECK (mode IN ('publish', 'unpublish', 'retry', 'reconcile', 'scheduled_reconcile')),
  status                TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  requested_by_staff_id TEXT,
  -- 照合のときだけ使う。見つかったずれの一覧（JSON配列）。
  diffs_json            TEXT,
  last_error_code       TEXT,
  started_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  completed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rich_menu_publish_runs_idem
  ON rich_menu_publish_runs(group_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_rich_menu_publish_runs_group
  ON rich_menu_publish_runs(group_id, started_at DESC);
