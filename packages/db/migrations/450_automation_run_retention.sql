-- v6-25 §15: 実行履歴の保持期間（条件外を含む明細90日・それ以前は日別件数13か月）。
-- 日別件数の受け皿を新設する。期限切れ明細の削除を一律に塞いでいた
-- 2つの全面禁止トリガは外す。削除は保持期間を過ぎた確定済み明細だけを
-- 定期処理（purgeExpiredAutomationRuns）が行う。未確定（queued/running/waiting）
-- の行は期限が来ても消さない。運用停止中の取りこぼしを消さないため。
-- 新表の追加とトリガの削除だけ。既存表の作り直しはしない。

CREATE TABLE IF NOT EXISTS automation_run_daily_counts (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  automation_id   TEXT NOT NULL,
  day             TEXT NOT NULL,
  status          TEXT NOT NULL,
  run_count       INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  step_count      INTEGER NOT NULL DEFAULT 0 CHECK (step_count >= 0),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (line_account_id, automation_id, day, status)
);

CREATE INDEX IF NOT EXISTS idx_automation_run_daily_counts_day
  ON automation_run_daily_counts(day);

DROP TRIGGER IF EXISTS trg_automation_runs_no_delete;
DROP TRIGGER IF EXISTS trg_automation_run_steps_no_delete;
