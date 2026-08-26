-- V6 オートメーション実行エンジン用の排他制御。
--
-- 1つの実行・処理につき結果行は1つだけにし、再試行は同じ行と
-- idempotency_key を使う。lease は Worker が途中終了した処理を、同じ
-- 冪等キーのまま安全に再開するために使う。

ALTER TABLE automation_runs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE automation_run_steps ADD COLUMN lease_expires_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_run_steps_one_per_step
  ON automation_run_steps(automation_run_id, step_key);

CREATE INDEX IF NOT EXISTS idx_automation_runs_due
  ON automation_runs(status, resume_at, lease_expires_at)
  WHERE status IN ('queued', 'waiting', 'running');
