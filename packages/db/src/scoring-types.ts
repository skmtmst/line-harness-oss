
export interface FriendScoreRow {
  id: string;
  friend_id: string;
  scoring_rule_id: string | null;
  score_change: number;
  reason: string | null;
  created_at: string;
  /** 列。旧行は NULL のままなので、表示側は欠損を許容する。 */
  event_type: string | null;
  source: string | null;
  rule_key: string | null;
  operation: 'delta' | 'set' | 'manual_adjustment' | null;
  score_before: number | null;
  score_after: number | null;
  occurred_at: string | null;
  executed_by_staff_id: string | null;
  executed_by_staff_name: string | null;
}
