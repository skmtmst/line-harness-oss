
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'skipped_condition';


export type StepStatus = 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'skipped' | 'cancelled';


export interface RunRow {
  id: string;
  line_account_id: string;
  automation_id: string;
  automation_version_id: string;
  friend_id: string | null;
  source_event_id: string;
  idempotency_key: string;
  status: RunStatus;
  current_step: number;
  input_event_json: string;
  is_test: number;
  action_config: string;
  execution_plan_json: string | null;
}


export interface StepRow {
  id: string;
  automation_run_id: string;
  step_key: string;
  action_type: string;
  common_action_version_id: string | null;
  attempt_number: number;
  idempotency_key: string;
  status: StepStatus;
  retry_at: string | null;
  lease_expires_at: string | null;
}
