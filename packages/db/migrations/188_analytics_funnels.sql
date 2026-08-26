-- V6分析の時系列ファネル。
-- 既存 funnels / funnel_steps は移行元として残し、公開後の定義と実行結果を不変で保存する。

CREATE TABLE IF NOT EXISTS analytics_event_coverage (
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  available_from   TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('available', 'partial', 'unavailable', 'failed')),
  reason           TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (line_account_id, event_type)
);

CREATE TABLE IF NOT EXISTS analytics_funnel_versions (
  id                     TEXT PRIMARY KEY,
  funnel_id              TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  line_account_id        TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version_number         INTEGER NOT NULL CHECK (version_number >= 1),
  window_days            INTEGER NOT NULL CHECK (window_days BETWEEN 1 AND 365),
  steps_json             TEXT NOT NULL CHECK (json_valid(steps_json)),
  segment_json           TEXT CHECK (segment_json IS NULL OR json_valid(segment_json)),
  comparison_groups_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(comparison_groups_json)),
  created_by             TEXT,
  created_at             TEXT NOT NULL,
  UNIQUE (funnel_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_analytics_funnel_versions_current
  ON analytics_funnel_versions(line_account_id, funnel_id, version_number DESC);

CREATE TRIGGER IF NOT EXISTS trg_analytics_funnel_versions_no_update
BEFORE UPDATE ON analytics_funnel_versions
BEGIN SELECT RAISE(ABORT, 'analytics_funnel_version_immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_analytics_funnel_versions_no_delete
BEFORE DELETE ON analytics_funnel_versions
BEGIN SELECT RAISE(ABORT, 'analytics_funnel_version_immutable'); END;

CREATE TABLE IF NOT EXISTS analytics_funnel_runs (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  funnel_id           TEXT NOT NULL REFERENCES funnels(id) ON DELETE RESTRICT,
  funnel_version_id   TEXT REFERENCES analytics_funnel_versions(id) ON DELETE RESTRICT,
  cohort_from         TEXT NOT NULL,
  cohort_to           TEXT NOT NULL,
  time_zone           TEXT NOT NULL,
  data_cutoff_at      TEXT NOT NULL,
  state               TEXT NOT NULL CHECK (state IN (
                        'pending', 'available', 'unavailable', 'partial', 'failed'
                      )),
  result_json         TEXT NOT NULL CHECK (json_valid(result_json)),
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_funnel_runs_account_time
  ON analytics_funnel_runs(line_account_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_analytics_funnel_runs_completed_immutable
BEFORE UPDATE ON analytics_funnel_runs
WHEN OLD.state != 'pending'
BEGIN SELECT RAISE(ABORT, 'analytics_funnel_run_immutable'); END;

CREATE TABLE IF NOT EXISTS analytics_funnel_run_members (
  run_id               TEXT NOT NULL REFERENCES analytics_funnel_runs(id) ON DELETE CASCADE,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id            TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  group_key            TEXT NOT NULL DEFAULT 'all',
  highest_step_order   INTEGER NOT NULL,
  state                TEXT NOT NULL CHECK (state IN ('completed', 'in_progress', 'dropped')),
  started_at           TEXT NOT NULL,
  last_reached_at      TEXT NOT NULL,
  deadline_at          TEXT NOT NULL,
  PRIMARY KEY (run_id, friend_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_analytics_funnel_members_selection
  ON analytics_funnel_run_members(run_id, group_key, highest_step_order, state, friend_id);

CREATE TABLE IF NOT EXISTS analytics_result_audiences (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind         TEXT NOT NULL CHECK (source_kind IN ('funnel')),
  source_result_id    TEXT NOT NULL REFERENCES analytics_funnel_runs(id) ON DELETE CASCADE,
  selection_key       TEXT NOT NULL,
  member_count        INTEGER NOT NULL DEFAULT 0,
  expires_at          TEXT NOT NULL,
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_result_audiences_expiry
  ON analytics_result_audiences(line_account_id, expires_at);

CREATE TABLE IF NOT EXISTS analytics_result_audience_members (
  audience_id         TEXT NOT NULL REFERENCES analytics_result_audiences(id) ON DELETE CASCADE,
  friend_id           TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  PRIMARY KEY (audience_id, friend_id)
);
