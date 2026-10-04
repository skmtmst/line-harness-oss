-- F-24 店ごとの自動で合わせるルール（予約枠・在庫 nGcY1）。
-- 1店1行。無ければ既定（全部オン・残り4席・止める）として読む。
CREATE TABLE IF NOT EXISTS rt_store_auto_rules (
  store_id TEXT PRIMARY KEY REFERENCES rt_stores(id) ON DELETE CASCADE,
  auto_assign_seats INTEGER NOT NULL DEFAULT 1,
  count_remaining INTEGER NOT NULL DEFAULT 1,
  merge_duplicates INTEGER NOT NULL DEFAULT 1,
  low_seat_threshold INTEGER NOT NULL DEFAULT 4,
  line_action TEXT NOT NULL DEFAULT 'stop' CHECK (line_action IN ('stop', 'reduce')),
  walkin_action TEXT NOT NULL DEFAULT 'stop' CHECK (walkin_action IN ('stop', 'reduce')),
  close_banner INTEGER NOT NULL DEFAULT 1,
  notify_line INTEGER NOT NULL DEFAULT 1,
  duplicate_notify INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
