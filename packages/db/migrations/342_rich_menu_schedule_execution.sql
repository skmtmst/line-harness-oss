-- E-08 (#621 司令塔裁定): 公開予約の上限付き再試行に必要な最小列だけ足す。
-- rich_menu_schedules (291) には status / run ID / last_error_code しかなく、
-- 「一時失敗のみ上限付きで再試行」「次回再試行を記録」が満たせない。
-- 上限回数はコード定数で持ち、列は増やさない。既存行は 0 / NULL のまま動く。
ALTER TABLE rich_menu_schedules ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);
ALTER TABLE rich_menu_schedules ADD COLUMN next_retry_at TEXT;
CREATE INDEX IF NOT EXISTS idx_rich_menu_schedules_retry
  ON rich_menu_schedules (status, next_retry_at);
