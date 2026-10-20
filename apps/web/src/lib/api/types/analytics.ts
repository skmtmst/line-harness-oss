export type AnalyticsMetricState =
  | 'available'
  | 'pending'
  | 'unavailable'
  | 'insufficient'
  | 'partial'
  | 'failed'

export type AnalyticsMetric<T> = {
  value: T | null
  state: AnalyticsMetricState
  reason: string | null
}

export type AnalyticsEnvelope<T> = {
  lineAccountId: string
  timeZone: string
  period: { from: string; to: string }
  dataCutoffAt: string
  data: T
}

export type AnalyticsFriendsOverview = AnalyticsEnvelope<{
  state: AnalyticsMetricState
  stateReason: string | null
  metrics: {
    added: AnalyticsMetric<number>
    removed: AnalyticsMetric<number>
    net: AnalyticsMetric<number>
    currentFriends: AnalyticsMetric<number>
    firstTime: AnalyticsMetric<number>
    returning: AnalyticsMetric<number>
  }
  days: Array<{ date: string; added: number; removed: number; net: number }>
  campaigns: Array<{
    id: string
    name: string
    kind: 'broadcast' | 'scenario'
    occurredAt: string
    date: string
  }>
  historyAvailableFrom: string | null
}>

export type AnalyticsReactionsOverview = AnalyticsEnvelope<{
  metrics: {
    sent: AnalyticsMetric<number>
    delivered: AnalyticsMetric<number>
    opened: AnalyticsMetric<number>
    lineClicked: AnalyticsMetric<number>
    trackedClicks: AnalyticsMetric<number>
    unavailableCampaigns: AnalyticsMetric<number>
  }
  campaigns: Array<{
    id: string
    name: string
    kind: 'broadcast' | 'scenario'
    sentAt: string
    targetPeople: AnalyticsMetric<number>
    delivered: AnalyticsMetric<number>
    /** シナリオの送信通数。届いた人数ではないので「到達」欄には出さない（監査R225） */
    sentMessages: AnalyticsMetric<number>
    opened: AnalyticsMetric<number>
    lineClicked: AnalyticsMetric<number>
    outcomes: AnalyticsMetric<number>
    fetchedAt: string | null
  }>
  /** 一覧の打切り情報。上限に達した系統だけ true になり、画面は「先頭○件まで表示」を出す。 */
  campaignsTruncation: { limit: number; broadcast: boolean; scenario: boolean }
  trackedClickHours: Array<{ hour: number; clicks: number }>
  clickDefinition: string
}>

export type AnalyticsRoutesOverview = AnalyticsEnvelope<{
  attributionModel: 'first_touch'
  attributionLabel: string
  routes: Array<{
    id: string
    refCode: string | null
    name: string
    clicks: AnalyticsMetric<number>
    friendAdds: AnalyticsMetric<number>
    currentFriends: AnalyticsMetric<number>
    reactionPeople: AnalyticsMetric<number>
    conversions: {
      approved: AnalyticsMetric<number>
      pending: AnalyticsMetric<number>
      rejected: AnalyticsMetric<number>
      revenue: AnalyticsMetric<number>
    }
    adCost: AnalyticsMetric<number>
    costPerFriend: AnalyticsMetric<number>
    costPerConversion: AnalyticsMetric<number>
    profitAfterAdCost: AnalyticsMetric<number>
  }>
  searchConsoleHref: string
}>

export type AnalyticsUsageOverview = AnalyticsEnvelope<{
  state: AnalyticsMetricState
  stateReason: string | null
  checkedAt: string
  automaticDeletion: false
  summary: {
    unusedItems: AnalyticsMetric<number>
    brokenReferences: AnalyticsMetric<number>
    automaticRuns: AnalyticsMetric<number>
    manualSends: AnalyticsMetric<number>
    estimatedHoursSaved: AnalyticsMetric<number>
  }
  categories: Array<{
    key: string
    label: string
    href: string
    created: AnalyticsMetric<number>
    inUse: AnalyticsMetric<number>
    unused: AnalyticsMetric<number>
    brokenReferences: AnalyticsMetric<number>
    lastUsedAt: AnalyticsMetric<string>
  }>
  /**
   * 全任意機能の利用状況（N-448）。共有カタログの featureId で機械照合する。
   * 計測できる機能は直近90日の回数（または現在の利用数）と最終利用を持ち、
   * 計測できない機能は activity/lastUsedAt が未取得＋理由を持つ。
   */
  features: Array<{
    featureId: string
    activityUnit: string | null
    activityBasis: 'last90days' | 'current' | null
    activity: AnalyticsMetric<number>
    lastUsedAt: AnalyticsMetric<string>
  }>
}>

export type AnalyticsUrlClicksOverview = AnalyticsEnvelope<{
  state: AnalyticsMetricState
  stateReason: string | null
  exposureAvailableFrom: string | null
  hasMore: boolean
  clickRateDefinition: string
  links: Array<{
    trackedLinkId: string
    name: string
    originalUrl: string
    shortCode: string | null
    isActive: boolean
    actions: { tagName: string | null; scenarioName: string | null }
    clicks: AnalyticsMetric<number>
    knownClickPeople: AnalyticsMetric<number>
    deliveredPeople: AnalyticsMetric<number>
    clickRate: AnalyticsMetric<number>
    firstClickedAt: AnalyticsMetric<string>
    lastClickedAt: AnalyticsMetric<string>
    usageLocations: string[]
  }>
}>

export type AnalyticsCrossAxis =
  | { kind: 'route' }
  | { kind: 'tag' }
  | { kind: 'field_choice'; fieldId: string }
  | { kind: 'score_band' }
  | { kind: 'conversion_point' }
  | { kind: 'booking_status' }
  | { kind: 'purchase_status' }

// 集計の物差し。events は packages/db の AnalyticsEventType をサーバ側が検査する。
export type AnalyticsCrossMeasure =
  | { kind: 'unique_friends' }
  | { kind: 'events'; eventType: string }

export type AnalyticsCrossResult = {
  lineAccountId: string
  timeZone: string
  rowValues: Array<{ key: string; label: string }>
  columnValues: Array<{ key: string; label: string }>
  cells: Array<{
    rowKey: string
    rowLabel: string
    columnKey: string
    columnLabel: string
    value: number
    uniqueFriends: number
    totalRatio: number | null
    previousValue: number
    difference: number
  }>
  totalValue: number
  totalFriends: number
  previousTotalValue: number
  periodFrom: string
  periodTo: string
  previousPeriodFrom: string
  previousPeriodTo: string
  dataCutoffAt: string
  state: 'available' | 'partial' | 'unavailable'
  stateReason: string | null
}

export type AnalyticsFunnelStepResult = {
  stepOrder: number
  label: string
  reached: number
  conversionFromPrevious: number | null
  droppedAfter: number
  inProgressAfter: number
  averageSecondsFromPrevious: number | null
  medianSecondsFromPrevious: number | null
}

export type AnalyticsFunnelRunResult = {
  runId: string | null
  funnelId: string
  versionId: string | null
  versionNumber: number | null
  lineAccountId: string
  cohortFrom: string
  cohortTo: string
  timeZone: string
  dataCutoffAt: string
  state: 'available' | 'unavailable' | 'partial' | 'failed'
  stateReason: string | null
  groups: Array<{
    key: string
    label: string
    entrants: number
    completed: number
    steps: AnalyticsFunnelStepResult[]
  }>
}

export type SavedAnalyticsSummary = {
  id: string
  name: string
  kind: 'cross' | 'funnel'
  status: 'active' | 'archived'
  currentVersionNumber: number
  createdBy: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
  snapshotCount: number
  latestSnapshot: {
    id: string
    state: 'available' | 'partial' | 'unavailable' | 'failed'
    periodFrom: string
    periodTo: string
    dataCutoffAt: string
    createdAt: string
    // ANALYTICS-05/06: 集計状態（未取得・失敗）とは別に、元の定義が
    // 写しを取った版から進んでいるか。版ずれの正しい対処は再集計。
    definitionStale: boolean
    sourceVersionNumber: number | null
    sourceCurrentVersionNumber: number | null
  } | null
}

export type SavedAnalyticsSnapshot = {
  id: string
  savedAnalysisId: string
  analysisVersionId: string
  sourceKind: 'cross' | 'funnel'
  sourceResultId: string
  periodFrom: string
  periodTo: string
  timeZone: string
  dataCutoffAt: string
  state: 'available' | 'partial' | 'unavailable' | 'failed'
  result: unknown
  createdBy: string | null
  createdAt: string
}

export type AnalyticsReportSection = 'friends' | 'reactions' | 'routes' | 'usage' | 'mileage'

export type AnalyticsReportRecipient = {
  kind: 'staff' | 'email'
  staffId?: string
  email?: string
  label: string
}

export type AnalyticsReportSchedule = {
  id: string
  lineAccountId: string
  name: string
  sections: AnalyticsReportSection[]
  savedAnalysisIds: string[]
  cadence: 'weekly' | 'monthly'
  weekday: number | null
  monthDay: number | null
  sendTime: string
  timeZone: string
  periodDays: number
  recipients: AnalyticsReportRecipient[]
  channels: Array<'dashboard' | 'email' | 'line'>
  alertRules: Array<{
    metric: 'block_rate' | 'friend_adds' | 'conversions'
    operator: 'greater_than' | 'decrease_percent' | 'zero_streak_days'
    threshold: number
    minimumSample: number
  }>
  status: 'active' | 'paused' | 'archived'
  isOneTime: boolean
  nextRunAt: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

// R454: 定期レポートの実行履歴（失敗理由・宛先別結果）。
export type AnalyticsReportDelivery = {
  channel: string
  recipient: string
  status: 'sent' | 'failed' | 'skipped'
  reason?: string
}

export type AnalyticsReportRun = {
  id: string
  scheduleId: string
  lineAccountId: string
  scheduledFor: string
  periodFrom: string
  periodTo: string
  timeZone: string
  dataCutoffAt: string
  state: 'running' | 'available' | 'partial' | 'unavailable' | 'failed'
  result: unknown
  deliveryResults: AnalyticsReportDelivery[]
  errorCode: string | null
  startedAt: string
  completedAt: string | null
}

export type RecentOneTimeReport = {
  schedule: AnalyticsReportSchedule
  lastRun: AnalyticsReportRun | null
}

export type AnalyticsReportScheduleOptions = {
  timeZone: string
  savedAnalyses: Array<{ id: string; name: string; kind: 'cross' | 'funnel' }>
  recipients: Array<{
    id: string
    name: string
    role: 'owner' | 'admin' | 'staff'
    email: string | null
    lineLinked: boolean
  }>
}
