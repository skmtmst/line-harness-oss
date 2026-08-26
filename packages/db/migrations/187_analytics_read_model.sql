-- V6分析の読取基盤。
-- 既存の業務テーブルを正本として残し、分析に必要な事実だけを追記する。

CREATE TABLE IF NOT EXISTS analytics_events (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id         TEXT REFERENCES friends(id) ON DELETE SET NULL,
  visitor_key       TEXT,
  event_type        TEXT NOT NULL,
  source_kind       TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  occurred_at       TEXT NOT NULL,
  dimensions_json  TEXT NOT NULL DEFAULT '{}'
                       CHECK (json_valid(dimensions_json)),
  numeric_value     REAL,
  currency          TEXT,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (line_account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_account_time
  ON analytics_events(line_account_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_account_type_time
  ON analytics_events(line_account_id, event_type, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_friend_time
  ON analytics_events(line_account_id, friend_id, occurred_at, id)
  WHERE friend_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  metric_date      TEXT NOT NULL,
  metric_key       TEXT NOT NULL,
  dimension_key    TEXT NOT NULL DEFAULT '',
  dimension_value  TEXT NOT NULL DEFAULT '',
  numerator        INTEGER,
  denominator      INTEGER,
  value            REAL,
  state            TEXT NOT NULL DEFAULT 'available'
                     CHECK (state IN (
                       'available', 'pending', 'unavailable',
                       'insufficient', 'partial', 'failed'
                     )),
  data_cutoff_at   TEXT NOT NULL,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (
    line_account_id, metric_date, metric_key, dimension_key, dimension_value
  )
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_metrics_account_date
  ON analytics_daily_metrics(line_account_id, metric_date DESC, metric_key);

CREATE TABLE IF NOT EXISTS analytics_reconciliation_runs (
  id                 TEXT PRIMARY KEY,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  range_from         TEXT NOT NULL,
  range_to           TEXT NOT NULL,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  projected_count    INTEGER NOT NULL DEFAULT 0,
  mismatch_count     INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('matched', 'mismatched', 'failed')),
  error_code         TEXT,
  started_at         TEXT NOT NULL,
  completed_at       TEXT NOT NULL,
  UNIQUE (line_account_id, range_to)
);

CREATE INDEX IF NOT EXISTS idx_analytics_reconciliation_account_time
  ON analytics_reconciliation_runs(line_account_id, completed_at DESC);
