import type { FriendAddEventAttributionStatus, FriendAddEventRoutingStatus } from '@line-crm/shared'

export type FriendAddRuleKind = 'first_time' | 'returning'

export type FriendAddRuleStatus = 'draft' | 'published' | 'stopped' | 'archived'

export type FriendAddRuleAction = {
  type: 'add_tag' | 'remove_tag' | 'start_scenario'
  label: string
  targetId?: string
}

export type FriendAddRuleDefinition = {
  routeIds: string[]
  scenarioId: string | null
  messageType: 'text' | 'template' | 'form' | 'scenario'
  messageText: string
  timing: 'immediate' | 'scenario'
  actions: FriendAddRuleAction[]
  friendCondition: string
  internalMemo?: string
  activeFrom: string | null
  activeUntil: string | null
  returningMode?: 'none' | 'same' | 'other'
  startPosition?: 'beginning' | 'resume'
  deliveryChoices?: {
    sendWelcomeMessage: boolean
    startScenario: boolean
    runActions: boolean
  }
  resendSuppressionHours?: number
  unknownRouteAction?: {
    sendCommonGuidance: boolean
    notifyStaff: boolean
  }
  weekdays?: number[]
  timeWindows?: Array<{ start: string; end: string }>
}

export type FriendAddRule = {
  id: string
  accountId: string
  friendKind: FriendAddRuleKind
  name: string
  folderName: string | null
  priority: number
  isFallback: boolean
  status: FriendAddRuleStatus
  versionId: string | null
  versionNumber: number | null
  versionStatus: 'draft' | 'published' | 'retired' | null
  lastTestStatus: 'succeeded' | 'failed' | null
  lastTestedAt: string | null
  lastTestedByStaffId: string | null
  lastTestedByStaffName: string | null
  publishedAt: string | null
  matchedLast7Days: number | null
  version: number
  definition: FriendAddRuleDefinition
  routeNames: string[]
  scenarioName: string | null
}

export type FriendAddRuleOptions = {
  routes: Array<{ id: string; name: string; kind: string }>
  scenarios: Array<{ id: string; name: string }>
  tags: Array<{ id: string; name: string }>
  folders: import('@line-crm/shared').FriendAddRuleFolder[]
}

export type FriendAddRuleListData = {
  items: FriendAddRule[]
  total: number
  nextCursor: string | null
  /** フォルダ欄の件数。全ページの合計で、検索・絞りの影響を受けない。 */
  folderCounts: Array<{ name: string | null; count: number }>
  summary: {
    rules: number
    active: number
    recentAdds: number | null
    captured: number | null
    unknownRoute: number | null
    delivered: number | null
    failed: number | null
  }
  options: FriendAddRuleOptions
}

export type FriendAddRuleInput = Pick<FriendAddRule, 'friendKind' | 'name' | 'folderName' | 'priority'> & {
  accountId: string
  version?: number
  definition: FriendAddRuleDefinition
}

export type FriendAddRuleConflictData = {
  conflicts: Array<{
    code: string
    ruleIds: string[]
    message: string
    matchedLast28Days: Record<string, number>
  }>
  rules: Array<{
    id: string
    name: string
    priority: number
    weekdays: number[]
    timeWindows: Array<{ start: string; end: string }>
    friendCondition: string | null
    matchedLast28Days: number
  }>
}

export type FriendAddRunList = {
  period?: { key: string; from: string | null; to: string | null }
  items: Array<{
    id: string
    receivedAt: string
    processedAt: string | null
    /** staff の応答は顧客を特定できない read model。 */
    friend: { id: string; displayName: string | null; redacted: false } | { displayName: string; redacted: true }
    friendKind: FriendAddRuleKind
    attribution: {
      status: FriendAddEventAttributionStatus
      routeId: string | null
      routeName: string | null
      reason: string | null
    }
    rule: { id: string; name: string | null; versionId: string | null; versionNumber: number | null } | null
    scenario: { id: string; name: string | null; enrollmentId: string | null; started: boolean } | null
    actions: { total: number; failed: number }
    deliveryCount: number
    status: FriendAddEventRoutingStatus
    errorCode: string | null
  }>
  total: number
  nextCursor: string | null
  summary: {
    capturedFriends?: number
    returning?: number
    testPending?: number | null
    testPendingState?: { state: 'unavailable'; reason: string }
    failureKinds?: Array<{ kind: 'delivery_unknown' | 'delivery_failed' | 'action_failed' | 'invalid_reference' | 'other'; count: number }>
    /** 直近28日に追加された人数（同じ人の再追加は1人）。 */
    recentFriends: number
    /** 直近28日の追加記録の件数（同じ人の再追加も数える）。 */
    recentEvents: number
    cumulativeDeliveries: number
    scenarioStarts: number
    averageSendTimeMs: number | null
    failed: number
    /** 実際に送った記録の最新日時。1件も送っていなければ null。 */
    lastDeliveryAt: string | null
    staffHandoffs: { value: number | null; state: 'available' | 'unavailable'; reason: string | null }
  }
}

export type FriendAddRunDetail = {
  id: string
  receivedAt: string
  processedAt: string | null
  friend: { id: string; displayName: string | null; redacted: false } | { displayName: string; redacted: true }
  friendKind: FriendAddRuleKind
  attribution: {
    status: FriendAddEventAttributionStatus
    routeId: string | null
    routeName: string | null
    reason: string | null
  }
  rule: ({
    id: string
    name: string | null
    versionId: string | null
    versionNumber: number | null
  } & { definition?: FriendAddRuleDefinition }) | null
  configuredActions?: unknown[]
  actionRuns: Array<{
    id: string
    stableId: string
    type: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    attemptCount: number
    nextRetryAt: string | null
    errorCode: string | null
    startedAt: string
    completedAt: string | null
    updatedAt: string
  }>
  status: FriendAddEventRoutingStatus
  errorCode: string | null
}
