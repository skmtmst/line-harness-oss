-- V6 定期レポート。設定と実行時点の結果を分け、過去の配信内容を不変に保つ。

CREATE TABLE IF NOT EXISTS analytics_report_schedules (
  id                         TEXT PRIMARY KEY,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL,
  sections_json              TEXT NOT NULL CHECK (json_valid(sections_json)),
  saved_analysis_ids_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(saved_analysis_ids_json)),
  cadence                    TEXT NOT NULL CHECK (cadence IN ('weekly','monthly')),
  weekday                    INTEGER CHECK (weekday BETWEEN 0 AND 6),
  month_day                  INTEGER CHECK (month_day BETWEEN 1 AND 28),
  send_time                  TEXT NOT NULL CHECK (send_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  time_zone                  TEXT NOT NULL,
  period_days                INTEGER NOT NULL CHECK (period_days BETWEEN 1 AND 397),
  recipients_json            TEXT NOT NULL CHECK (json_valid(recipients_json)),
  channels_json              TEXT NOT NULL CHECK (json_valid(channels_json)),
  alert_rules_json           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alert_rules_json)),
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  is_one_time                INTEGER NOT NULL DEFAULT 0 CHECK (is_one_time IN (0,1)),
  next_run_at                TEXT NOT NULL,
  created_by                 TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  CHECK ((cadence = 'weekly' AND weekday IS NOT NULL AND month_day IS NULL)
      OR (cadence = 'monthly' AND month_day IS NOT NULL AND weekday IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_analytics_report_schedules_due
  ON analytics_report_schedules(status, next_run_at, line_account_id);

CREATE TABLE IF NOT EXISTS analytics_report_runs (
  id                         TEXT PRIMARY KEY,
  schedule_id                TEXT NOT NULL REFERENCES analytics_report_schedules(id) ON DELETE CASCADE,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  scheduled_for              TEXT NOT NULL,
  period_from                TEXT NOT NULL,
  period_to                  TEXT NOT NULL,
  time_zone                  TEXT NOT NULL,
  data_cutoff_at             TEXT NOT NULL,
  state                      TEXT NOT NULL CHECK (state IN ('running','available','partial','unavailable','failed')),
  result_json                TEXT NOT NULL CHECK (json_valid(result_json)),
  delivery_results_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(delivery_results_json)),
  error_code                 TEXT,
  started_at                 TEXT NOT NULL,
  completed_at               TEXT,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_analytics_report_runs_history
  ON analytics_report_runs(line_account_id, schedule_id, scheduled_for DESC);

CREATE TRIGGER IF NOT EXISTS trg_analytics_report_runs_snapshot_immutable
BEFORE UPDATE OF period_from, period_to, time_zone, data_cutoff_at, result_json
ON analytics_report_runs
WHEN OLD.state != 'running'
BEGIN SELECT RAISE(ABORT, 'analytics_report_snapshot_immutable'); END;
