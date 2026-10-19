import type { RunRow, StepRow } from './run-types.js';


export async function getRun(db: D1Database, runId: string): Promise<RunRow | null> {
  return db.prepare(
    `SELECT r.id, r.line_account_id, r.automation_id, r.automation_version_id,
            r.friend_id, r.source_event_id, r.idempotency_key, r.status,
            r.current_step, r.input_event_json, r.is_test, v.action_config,
            r.execution_plan_json
       FROM automation_runs r
       JOIN automation_versions v
         ON v.id = r.automation_version_id AND v.automation_id = r.automation_id
      WHERE r.id = ?`,
  ).bind(runId).first<RunRow>();
}


export async function getStep(db: D1Database, runId: string, stepKey: string): Promise<StepRow | null> {
  return db.prepare(
    `SELECT id, automation_run_id, step_key, action_type, common_action_version_id,
            attempt_number, idempotency_key, status, retry_at, lease_expires_at
       FROM automation_run_steps
      WHERE automation_run_id = ? AND step_key = ?`,
  ).bind(runId, stepKey).first<StepRow>();
}
