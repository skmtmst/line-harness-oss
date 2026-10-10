export type RestaurantFollowupTrigger = 'reservation_created' | 'reservation_24h' | 'reservation_2h' | 'post_visit' | 'review_request' | 'waitlist_invited';
export interface RestaurantFollowupTemplate {
    store_id: string;
    scenario_id: string;
    template_version: number;
    sending_status: 'stopped' | 'pending' | 'active';
    approved_version_id: string | null;
    approval_id: string | null;
}
export interface RestaurantFollowupBinding {
    store_id: string;
    trigger: RestaurantFollowupTrigger;
    step_id: string;
    offset_minutes: number;
    enabled: 0 | 1;
    version: number;
}
export interface RestaurantFollowupJob {
    id: string;
    line_account_id: string;
    friend_id: string;
    scenario_version_id: string;
    step_id: string;
    source_kind: 'restaurant_reservation' | 'restaurant_waitlist';
    source_id: string;
    source_event_id: string;
    source_version: number;
    scheduled_at: string;
    status: 'pending' | 'running' | 'sent' | 'cancelled' | 'failed';
    attempt_count: number;
    lease_until: string | null;
    idempotency_key: string;
    message_log_id: string | null;
}
export interface RestaurantFollowupPage {
    template: RestaurantFollowupTemplate;
    bindings: RestaurantFollowupBinding[];
    jobs: RestaurantFollowupJob[];
    editor: 'common_scenario';
}
export type RestaurantConfirmationResponse = 'going' | 'change_requested' | 'cancel';
export interface RestaurantConfirmation {
    request_id: string;
    reservation_id: string;
    reservation_version: number;
    friend_id: string;
    response: RestaurantConfirmationResponse | null;
    requested_at: string;
    responded_at: string | null;
    expires_at: string;
    is_current: 0 | 1;
}
