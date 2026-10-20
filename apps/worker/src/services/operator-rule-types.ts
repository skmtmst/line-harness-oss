
export type OperatorRuleConditions = {
  teamId?: string;
  schedule?: 'anytime'|'business_hours'|'morning_digest';
  threshold?: 'one'|'three'|'ten';
  onlyAvailable?: boolean;
  importance?: string;
  recipientIds?: string[];
  recipientLabel?: string;
  message?: string;
  actionUrl?: string;
  dedupeMinutes?: number;
};
