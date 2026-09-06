-- 機能25: 一覧集計と、共通アクションの利用版変更履歴。
--
-- 一覧の30日集計は既存の実行台帳を正本にする。利用先の版変更は、
-- 「誰が、どの版からどの版へ変えたか」を後から追えるよう別表へ残す。

CREATE INDEX IF NOT EXISTS idx_automation_runs_definition_metrics
  ON automation_runs(automation_id, is_test, created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_common_action_metrics
  ON automation_run_steps(common_action_version_id, automation_run_id, status, step_key)
  WHERE common_action_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS common_action_binding_migration_events (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  common_action_id         TEXT NOT NULL REFERENCES common_actions(id),
  binding_id               TEXT NOT NULL REFERENCES common_action_bindings(id),
  from_action_version_id   TEXT NOT NULL REFERENCES common_action_versions(id),
  to_action_version_id     TEXT NOT NULL REFERENCES common_action_versions(id),
  actor_id                 TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_common_action_binding_migrations_binding
  ON common_action_binding_migration_events(binding_id, created_at DESC);

