// -----------------------------------------------------------------------------
// スコアリング (Lead Scoring)
// -----------------------------------------------------------------------------

export interface ScoringRule {
  id: string;
  name: string;
  eventType: string;
  scoreValue: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FriendScore {
  id: string;
  friendId: string;
  scoringRuleId: string | null;
  scoreChange: number;
  reason: string | null;
  createdAt: string;
}
