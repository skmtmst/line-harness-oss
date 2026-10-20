export interface GettingStartedStep {
  key: 'accounts' | 'featureSet' | 'attributes' | 'friendAdd' | 'scenario' | 'firstMessage';
  state: 'done' | 'stalled' | 'todo' | 'forbidden' | 'unknown';
  href: string | null;
  reason: string | null;
  webhook?: Array<{ id: string; status: 'matched' | 'mismatched' | 'unconfigured' | 'unknown'; active?: boolean | null }>;
}

export interface DashboardActivityItem {
  id: string;
  kind: 'broadcast_sent' | 'booking_created' | 'event_booking_created' | 'form_submitted' | 'friend_added';
  summary: string;
  occurredAt: string;
  href: string;
}
