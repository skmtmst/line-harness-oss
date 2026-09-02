-- V6 3-1-C: 友だち一括操作をブラウザの人数分リクエストにせず、
-- 対象固定・対象別の結果・失敗分だけの再試行をサーバ側に残す。
CREATE TABLE IF NOT EXISTS friend_bulk_runs (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  created_by               TEXT NOT NULL,
  selection_json           TEXT NOT NULL CHECK (json_valid(selection_json)),
  operation_json           TEXT NOT NULL CHECK (json_valid(operation_json)),
  execution_plan_json      TEXT CHECK (execution_plan_json IS NULL OR json_valid(execution_plan_json)),
  status                   TEXT NOT NULL DEFAULT 'preparing'
                             CHECK (status IN ('preparing','queued','running','waiting','success','partial','failed','cancelled')),
  target_count             INTEGER NOT NULL DEFAULT 0,
  excluded_count           INTEGER NOT NULL DEFAULT 0,
  success_count            INTEGER NOT NULL DEFAULT 0,
  skipped_count            INTEGER NOT NULL DEFAULT 0,
  temporary_failure_count  INTEGER NOT NULL DEFAULT 0,
  permanent_failure_count  INTEGER NOT NULL DEFAULT 0,
  reversible               INTEGER NOT NULL DEFAULT 0 CHECK (reversible IN (0,1)),
  idempotency_key          TEXT NOT NULL,
  scheduled_at             TEXT,
  undo_of_run_id           TEXT REFERENCES friend_bulk_runs(id),
  error_message            TEXT,
  created_at               TEXT NOT NULL,
  started_at               TEXT,
  completed_at             TEXT,
  updated_at               TEXT NOT NULL,
  UNIQUE (tenant_id, created_by, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_friend_bulk_runs_due
  ON friend_bulk_runs(status, scheduled_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_friend_bulk_runs_actor
  ON friend_bulk_runs(tenant_id, created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS friend_bulk_run_items (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES friend_bulk_runs(id) ON DELETE CASCADE,
  friend_id         TEXT NOT NULL REFERENCES friends(id) ON DELETE RESTRICT,
  line_account_id   TEXT,
  ordinal           INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','waiting','success','skipped','temporary_failure','permanent_failure')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  idempotency_key   TEXT NOT NULL,
  before_json       TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json        TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  error_code        TEXT,
  error_message     TEXT,
  retry_at          TEXT,
  lease_expires_at  TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (run_id, friend_id),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_friend_bulk_run_items_work
  ON friend_bulk_run_items(run_id, status, retry_at, lease_expires_at, ordinal);
