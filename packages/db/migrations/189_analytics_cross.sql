-- V6分析のクロス集計。
-- 任意SQLは保存せず、検証済みの軸・条件と不変の結果だけを保持する。

CREATE TABLE IF NOT EXISTS analytics_cross_runs (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  query_json        TEXT NOT NULL CHECK (json_valid(query_json)),
  state             TEXT NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending','running','available','partial','unavailable','failed')),
  result_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  error_code        TEXT,
  period_from       TEXT NOT NULL,
  period_to         TEXT NOT NULL,
  time_zone         TEXT NOT NULL,
  data_cutoff_at    TEXT NOT NULL,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_cross_runs_pending
  ON analytics_cross_runs(state, created_at, id);
CREATE INDEX IF NOT EXISTS idx_analytics_cross_runs_account_time
  ON analytics_cross_runs(line_account_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_analytics_cross_runs_completed_immutable
BEFORE UPDATE ON analytics_cross_runs
WHEN OLD.state IN ('available','partial','unavailable','failed')
BEGIN SELECT RAISE(ABORT, 'analytics_cross_run_immutable'); END;

CREATE TABLE IF NOT EXISTS analytics_cross_run_members (
  run_id           TEXT NOT NULL REFERENCES analytics_cross_runs(id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  row_key          TEXT NOT NULL,
  col_key          TEXT NOT NULL,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, row_key, col_key, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_cross_members_selection
  ON analytics_cross_run_members(run_id, row_key, col_key, friend_id);

-- 188ではファネル専用の外部キーだった。一時対象者をクロス分析にも使えるように、
-- 種類ごとの存在確認をtriggerへ移し、既存行と24時間期限を保ったまま広げる。
ALTER TABLE analytics_result_audience_members RENAME TO analytics_result_audience_members_v1;
ALTER TABLE analytics_result_audiences RENAME TO analytics_result_audiences_v1;
DROP INDEX IF EXISTS idx_analytics_result_audiences_expiry;

CREATE TABLE analytics_result_audiences (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_kind         TEXT NOT NULL CHECK (source_kind IN ('funnel','cross')),
  source_result_id    TEXT NOT NULL,
  selection_key       TEXT NOT NULL,
  member_count        INTEGER NOT NULL DEFAULT 0,
  expires_at          TEXT NOT NULL,
  created_by          TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_analytics_result_audiences_expiry
  ON analytics_result_audiences(line_account_id, expires_at);

CREATE TRIGGER trg_analytics_result_audiences_funnel_reference
BEFORE INSERT ON analytics_result_audiences
WHEN NEW.source_kind = 'funnel'
 AND NOT EXISTS (
   SELECT 1 FROM analytics_funnel_runs r
    WHERE r.id = NEW.source_result_id AND r.line_account_id = NEW.line_account_id
 )
BEGIN SELECT RAISE(ABORT, 'analytics_result_source_not_found'); END;

CREATE TRIGGER trg_analytics_result_audiences_cross_reference
BEFORE INSERT ON analytics_result_audiences
WHEN NEW.source_kind = 'cross'
 AND NOT EXISTS (
   SELECT 1 FROM analytics_cross_runs r
    WHERE r.id = NEW.source_result_id AND r.line_account_id = NEW.line_account_id
 )
BEGIN SELECT RAISE(ABORT, 'analytics_result_source_not_found'); END;

CREATE TABLE analytics_result_audience_members (
  audience_id         TEXT NOT NULL REFERENCES analytics_result_audiences(id) ON DELETE CASCADE,
  friend_id           TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  PRIMARY KEY (audience_id, friend_id)
);

INSERT INTO analytics_result_audiences (
  id, line_account_id, source_kind, source_result_id, selection_key,
  member_count, expires_at, created_by, created_at
)
SELECT id, line_account_id, source_kind, source_result_id, selection_key,
       member_count, expires_at, created_by, created_at
  FROM analytics_result_audiences_v1;

INSERT INTO analytics_result_audience_members (audience_id, friend_id)
SELECT audience_id, friend_id FROM analytics_result_audience_members_v1;

DROP TABLE analytics_result_audience_members_v1;
DROP TABLE analytics_result_audiences_v1;
