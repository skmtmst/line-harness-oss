-- 分析の日別再集計をイベント単位に分け、アカウントを巡回する進捗。
CREATE TABLE IF NOT EXISTS analytics_projection_scheduler_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_account_id TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_projection_progress (
  line_account_id   TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  cycle_id          TEXT NOT NULL,
  range_from        TEXT NOT NULL,
  range_to          TEXT NOT NULL,
  time_zone         TEXT NOT NULL,
  data_cutoff_at    TEXT NOT NULL,
  broad_from        TEXT NOT NULL,
  broad_to          TEXT NOT NULL,
  last_occurred_at  TEXT NOT NULL DEFAULT '',
  last_event_id     TEXT NOT NULL DEFAULT '',
  source_event_count INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_projection_metric_stage (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  cycle_id        TEXT NOT NULL,
  metric_date     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  event_count     INTEGER NOT NULL,
  unique_friend_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (line_account_id, cycle_id, metric_date, event_type)
);

CREATE TABLE IF NOT EXISTS analytics_projection_friend_stage (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  cycle_id        TEXT NOT NULL,
  metric_date     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  friend_id       TEXT NOT NULL,
  PRIMARY KEY (line_account_id, cycle_id, metric_date, event_type, friend_id)
);

-- INSERT OR IGNORE で本当に増えた友だちだけを増分集計する。
-- 完走時に全中間行を COUNT し直さず、1回の読込上限を守る。
CREATE TRIGGER IF NOT EXISTS analytics_projection_friend_stage_count
AFTER INSERT ON analytics_projection_friend_stage
BEGIN UPDATE analytics_projection_metric_stage SET unique_friend_count = unique_friend_count + 1 WHERE line_account_id = NEW.line_account_id AND cycle_id = NEW.cycle_id AND metric_date = NEW.metric_date AND event_type = NEW.event_type; END;
