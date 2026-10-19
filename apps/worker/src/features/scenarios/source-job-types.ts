
export interface ScenarioSourceJob {
    id: string;
    line_account_id: string;
    friend_id: string;
    scenario_version_id: string;
    step_id: string;
    source_kind: string;
    source_id: string;
    source_event_id: string;
    source_version: number;
    scheduled_at: string;
    status: string;
    attempt_count: number;
    lease_until: string | null;
    idempotency_key: string;
    message_log_id: string | null;
}
