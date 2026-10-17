export interface ResearchAnswerAction {
  actionType: 'tag' | 'friend_field' | 'support_mark' | 'scenario' | 'common_var' | 'send_message' | 'send_template' | 'reminder' | 'event_booking' | 'notify_staff';
  config: Record<string, unknown>;
  onFailure: 'stop' | 'continue';
}
export interface ResearchGate {
  assetId: string;
  version: number;
  startsAt: string | null;
  endsAt: string | null;
  targetTagId: string | null;
}
