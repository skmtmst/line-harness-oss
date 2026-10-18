export type ActionScoreBand = 'high' | 'normal' | 'low'

export type ActionScoreFilter = 'all' | ActionScoreBand | 'decreased'

export type ActionScoreSort = 'score_desc' | 'score_asc' | 'change_desc' | 'change_asc' | 'recent_desc'

export type ActionScoreOverview = {
  summary: {
    scoredFriends: number
    high: number
    normal: number
    low: number
    decreased30d: number
    highMin: number
    normalMin: number
  }
  items: Array<{
    friendId: string
    displayName: string
    pictureUrl: string | null
    currentScore: number
    band: ActionScoreBand
    change30d: number
    lastReason: string | null
    lastChangedAt: string | null
  }>
  pagination: { total: number; limit: number; offset: number }
}

export type ActionScoreRuleOperation = 'delta' | 'set'

export type ActionScoreFrequencyKind =
  | 'unlimited'
  | 'per_day'
  | 'per_subject'
  | 'per_subject_per_day'
  | 'once_per_period'

export type ActionScoreRule = {
  id: string
  name: string
  eventType: string
  source: string | null
  operation: ActionScoreRuleOperation
  value: number
  frequency: { kind: ActionScoreFrequencyKind; limit: number }
  sameSourceEventOnce: true
  validFrom: string | null
  validUntil: string | null
  enabled: boolean
}

export type ActionScoreBands = {
  min: number
  max: number
  normalMin: number
  highMin: number
}

export type ActionScoreRuleBundle = { rules: ActionScoreRule[]; bands: ActionScoreBands }

export type ActionScoreRuleVersion = ActionScoreRuleBundle & {
  id: string | null
  versionNumber: number
  status: 'draft' | 'published'
  createdAt: string | null
  publishedAt: string | null
}

export type ActionScoreRuleConfiguration = {
  configured: boolean
  status: 'not_configured' | 'draft' | 'published' | 'stopped'
  currentDraftVersionId: string | null
  currentPublishedVersionId: string | null
  editableVersion: ActionScoreRuleVersion
  publishedVersion: ActionScoreRuleVersion | null
}

export type ActionScoreRuleTestResult = {
  scoreBefore: number
  scoreAfter: number
  bandBefore: ActionScoreBand
  bandAfter: ActionScoreBand
  matched: Array<{ ruleId: string; ruleName: string; scoreBefore: number; scoreAfter: number }>
}

export type ActionScoreAdjustmentResult = {
  historyId: string
  scoreBefore: number
  scoreAfter: number
  appliedChange: number
  bandBefore: ActionScoreBand
  bandAfter: ActionScoreBand
  replayed: boolean
}

export type ActionScoreBandPreview = {
  bands: ActionScoreBands
  counts: { low: number; normal: number; high: number }
  totalFriends: number
  measuredAt: string
}

/**
 * 1人の点数と、その点数になった記録の明細。
 * `scoreBefore` / `scoreAfter` / `eventType` は移行前の行では欠ける。
 */
export type FriendScoreHistoryItem = {
  id: string
  scoringRuleId: string | null
  ruleKey: string | null
  scoreChange: number
  scoreBefore: number | null
  scoreAfter: number | null
  reason: string | null
  eventType: string | null
  source: string | null
  occurredAt: string
  createdAt: string
  mode: 'manual' | 'automatic'
  executedByStaffName: string | null
}

export type FriendScoreDetail = {
  friendId: string
  currentScore: number
  history: FriendScoreHistoryItem[]
}
