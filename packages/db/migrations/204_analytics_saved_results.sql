-- V6分析の保存。定義の版と実行時点の結果を分け、後の編集で過去結果を変えない。

CREATE TABLE IF NOT EXISTS analytics_saved_analyses (
  id                     TEXT PRIMARY KEY,
  line_account_id        TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('cross','funnel')),
  current_version_number INTEGER NOT NULL DEFAULT 1 CHECK (current_version_number >= 1),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by             TEXT,
  created_by_name        TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_saved_analyses_account
  ON analytics_saved_analyses(line_account_id, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS analytics_saved_analysis_versions (
  id                  TEXT PRIMARY KEY,
  saved_analysis_id   TEXT NOT NULL REFERENCES analytics_saved_analyses(id) ON DELETE CASCADE,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL CHECK (version_number >= 1),
  definition_json     TEXT NOT NULL CHECK (json_valid(definition_json)),
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (saved_analysis_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_analytics_saved_versions_current
  ON analytics_saved_analysis_versions(line_account_id, saved_analysis_id, version_number DESC);

CREATE TRIGGER IF NOT EXISTS trg_analytics_saved_versions_no_update
BEFORE UPDATE ON analytics_saved_analysis_versions
BEGIN SELECT RAISE(ABORT, 'analytics_saved_version_immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_analytics_saved_versions_no_delete
BEFORE DELETE ON analytics_saved_analysis_versions
BEGIN SELECT RAISE(ABORT, 'analytics_saved_version_immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_analytics_saved_versions_same_account
BEFORE INSERT ON analytics_saved_analysis_versions
WHEN NOT EXISTS (
  SELECT 1 FROM analytics_saved_analyses a
   WHERE a.id = NEW.saved_analysis_id AND a.line_account_id = NEW.line_account_id
)
BEGIN SELECT RAISE(ABORT, 'analytics_saved_parent_mismatch'); END;

CREATE TABLE IF NOT EXISTS analytics_saved_analysis_snapshots (
  id                    TEXT PRIMARY KEY,
  saved_analysis_id     TEXT NOT NULL REFERENCES analytics_saved_analyses(id) ON DELETE CASCADE,
  analysis_version_id   TEXT NOT NULL REFERENCES analytics_saved_analysis_versions(id) ON DELETE RESTRICT,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind           TEXT NOT NULL CHECK (source_kind IN ('cross','funnel')),
  source_result_id      TEXT NOT NULL,
  period_from           TEXT NOT NULL,
  period_to             TEXT NOT NULL,
  time_zone             TEXT NOT NULL,
  data_cutoff_at        TEXT NOT NULL,
  state                 TEXT NOT NULL CHECK (state IN ('available','partial','unavailable','failed')),
  result_json           TEXT NOT NULL CHECK (json_valid(result_json)),
  created_by            TEXT,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_saved_snapshots_history
  ON analytics_saved_analysis_snapshots(line_account_id, saved_analysis_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_analytics_saved_snapshots_no_update
BEFORE UPDATE ON analytics_saved_analysis_snapshots
BEGIN SELECT RAISE(ABORT, 'analytics_saved_snapshot_immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_analytics_saved_snapshots_same_parent
BEFORE INSERT ON analytics_saved_analysis_snapshots
WHEN NOT EXISTS (
  SELECT 1
    FROM analytics_saved_analyses a
    JOIN analytics_saved_analysis_versions v
      ON v.id = NEW.analysis_version_id
     AND v.saved_analysis_id = a.id
     AND v.line_account_id = a.line_account_id
   WHERE a.id = NEW.saved_analysis_id
     AND a.line_account_id = NEW.line_account_id
)
BEGIN SELECT RAISE(ABORT, 'analytics_saved_parent_mismatch'); END;
