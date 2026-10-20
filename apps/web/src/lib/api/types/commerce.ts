import type { IdentityCandidateImpactMetric, EcIdentityDuplicateSignal } from '@line-crm/shared'

/** L (#824 数字の出どころ): 出どころ別の失敗の数。台帳の件数と一致する。 */
export type DeliveryFailureOrigin = {
  source: string | null
  failures: number
  latestFailedAt: string | null
  sampleDeliveryIds: string[]
}

export type DeliveryFailureOrigins = {
  total: number
  asOf: string | null
  origins: DeliveryFailureOrigin[]
}

export type EcCommerceOverview = {
  total: number
  processed: number
  identityPending: number
  failed: number
  skipped: number
  last24h: number
  lastReceivedAt: string | null
  byType: Array<{ eventType: string; label: string; count: number }>
  /** 定期便の契約数。タブの数字はここから取る(#731)。 */
  subscriptions: number
}

export type EcCommerceEvent = {
  id: string
  externalEventId: string
  eventType: string
  eventLabel: string
  customerId: string | null
  friendId: string | null
  friendName: string | null
  orderNumber: string | null
  status: 'received' | 'identity_pending' | 'processing' | 'processed' | 'skipped' | 'failed'
  errorMessage: string | null
  receivedAt: string
  processedAt: string | null
}

export type EcOrderLine = {
  id: string
  productId: string | null
  productName: string
  quantity: number
  unitAmount: number | null
  lineAmount: number | null
  productUrl: string | null
}

export type EcOrder = {
  id: string
  lineAccountId: string
  externalOrderId: string
  orderNumber: string
  customerId: string | null
  friendId: string | null
  customerName: string | null
  status: 'current' | 'refunded' | 'cancelled'
  providerStatus: string
  currency: string
  totalAmount: number | null
  refundedAmount: number | null
  orderedAt: string
  detailUrl: string | null
  version: number
  orderLines: EcOrderLine[]
}

export type EcOrderList = {
  items: EcOrder[]
  total: number
  summary: {
    total: number
    current: number
    refunded: number
    cancelled: number
    totalAmount: number
  }
}

export type EcActionExecutionStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'skipped'
  | 'retryable_failed'
  | 'permanent_failed'

export type EcFailureKind =
  | 'unlinked'
  | 'not_following'
  | 'permission'
  | 'communication'
  | 'rejected'
  | 'by_setting'
  | 'internal'

export type EcActionExecution = {
  id: string
  eventId: string
  eventType: string
  actionType: string
  ruleVersion: string
  status: EcActionExecutionStatus
  attemptCount: number
  maxAttempts: number
  errorCode: string | null
  errorMessage: string | null
  lastAttemptedAt: string | null
  nextRetryAt: string | null
  version: number
  receivedAt: string
  orderNumber: string | null
  customerName: string | null
  friendId: string | null
  retryAvailable: boolean
  /** 失敗・見送りの業務分類。正常・処理中は null。 */
  failureKind: EcFailureKind | null
}

export type EcActionExecutionList = {
  items: EcActionExecution[]
  total: number
  summary: Record<EcActionExecutionStatus, number>
}

/* IDEA-23: 注文1件の処理状況（GET /api/ec-commerce/orders/:id）の応答。 */
export type EcOrderDetailAttempt = {
  attemptNumber: number
  triggerKind: 'automatic' | 'manual'
  toStatus: string
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

export type EcOrderDetailDispatch = {
  subscriber: 'notification' | 'v6'
  status: 'pending' | 'sent' | 'failed'
  attemptCount: number
  updatedAt: string
  failureKind: EcFailureKind | null
}

export type EcOrderDetailDelivery = {
  id: string
  audienceType: 'customer' | 'operator'
  channel: 'line' | 'email' | 'in_app'
  status: 'pending' | 'provider_accepted' | 'excluded' | 'retry_wait' | 'failed'
  retryable: boolean
  attempts: number
  errorCode: string | null
  errorMessage: string | null
  failureKind: EcFailureKind | null
  queuedAt: string
  acceptedAt: string | null
  nextRetryAt: string | null
  executionMode: string
}

export type EcOrderDetailEvent = {
  id: string
  externalEventId: string
  eventType: string
  status: string
  failureKind: EcFailureKind | null
  receivedAt: string
  processedAt: string | null
  actions: Array<EcActionExecution & { attempts: EcOrderDetailAttempt[] }>
  dispatches: EcOrderDetailDispatch[]
  deliveries: EcOrderDetailDelivery[]
}

export type EcOrderDetailFollowUp = {
  id: string
  campaignKey: string
  campaignLabel: string | null
  scheduledAt: string
  status: string
  attempts: number
  sentAt: string | null
  reason: string | null
  failureKind: EcFailureKind | null
}

export type EcOrderDetail = {
  order: EcOrder
  events: EcOrderDetailEvent[]
  followUps: EcOrderDetailFollowUp[]
  outcomes: {
    conversions: Array<{
      id: string
      pointName: string | null
      approvalStatus: 'pending' | 'approved' | 'rejected' | null
      value: number | null
      createdAt: string
      /** 成果の起こりの根拠（注文番号・EC側の出来事ID） */
      orderNumber: string | null
      ecEventId: string | null
      /** 帰属した紹介者。直接の成果は null */
      affiliateName: string | null
      /** 承認時に固定された報酬額。承認前・計算不可は null（未確定） */
      rewardAmount: number | null
      /** 支払い確定の行の状態（settled/paid/reversed 等）。無ければ null */
      rewardEntryStatus: string | null
      /** 確定後の取消で起きた反対仕訳の金額。無ければ null */
      reversedAmount: number | null
      /** 締めの状態（closed/exported/paid/…）。締め前は null */
      settlementState: string | null
      /** 支払いCSV束の最新の状態（created/approved/exported/imported）。無ければ null */
      payoutBatchState: string | null
      /** 取り込んだ支払い結果（paid/failed/returned）。無ければ null */
      payoutResult: string | null
      /** 同じ注文・同じ成果地点の成果がほかにもあるとき true */
      duplicateCandidate: boolean
    }>
    mileage: Array<{
      id: string
      entryType: string
      amount: number
      status: string
      reason: string
      occurredAt: string
    }>
    scores: Array<{
      id: string
      scoreChange: number
      reason: string | null
      occurredAt: string
    }>
  }
}

export type EcIdentityCandidateSummary = import('@line-crm/shared').EcIdentityCandidateSummary

export type EcIdentityCandidateOperationsList = {
  items: Array<{
    id: string
    status: string
    version: number
    confidenceScore: number
    left: unknown
    right: unknown
    evidence: unknown
    // #580 軽: 影響は共有の計量型で受ける（DBは impact_json の配列を返す）。
    // 形が違う応答は画面側のガードで「—（未取得）」に倒す。
    impact: IdentityCandidateImpactMetric[]
    detectedAt: string
    reviewedAt: string | null
  } & EcIdentityDuplicateSignal>
  total: number
  summary: EcIdentityCandidateSummary
}

export type EcSubscription = {
  id: string
  friendId: string
  ownerName: string | null
  petName: string | null
  contractNumber: string | null
  status: 'active' | 'paused' | 'at_risk' | 'cancelled'
  statusLabel: string
  riskReason: string | null
  nextShippingAt: string | null
  /** ECが契約ごとに渡す定期便の変更ページ（httpsのみ）。無い契約は null。 */
  manageUrl: string | null
  cycle: string | null
  items: string | null
  amount: number | null
  continuedCount: number | null
  startedAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  syncedAt: string
}

export type EcSubscriptionList = {
  items: EcSubscription[]
  summary: {
    total: number
    active: number
    paused: number
    atRisk: number
    cancelled: number
    monthlyAmount: number | null
    startedThisMonth: number | null
    cancelledThisMonth: number | null
    cancellationTopReason: string | null
    monthlyStats: Array<{ month: string; count: number; amount: number }>
  }
  /** 形が違って読めなかったスナップショットの数。0 でも必ず返る(#731)。 */
  skipped: { malformedSnapshots: number }
  risk: {
    source: 'payment_status'
    ruleVersion: string
    calculatedAt: string | null
    predictiveScoreAvailable: false
  }
}

export type EcConnector = {
  id: string
  provider: 'ec_cube' | 'shopify'
  shopDomain: string
  status: 'connected' | 'degraded' | 'paused' | 'auth_expired' | 'rate_limited'
  secretConfigured: boolean
  secretLastFour: string | null
  secretUpdatedAt: string | null
  eventTypes: string[]
  identityRules: Array<'verified_email' | 'verified_phone' | 'manual_name_postal'>
  version: number
  updatedAt: string
}

export type EcConnectorOverview = {
  configured: boolean
  connector: EcConnector | null
  health: {
    today: number
    last30Days: number
    failed: number
    lastReceivedAt: string | null
    lastSucceededAt: string | null
  }
  impact: {
    nenCampaigns: number | null
    conversions: number | null
    mileageRules: number | null
    friendFields: number | null
    analytics: number | null
  }
  retryPolicy: string | null
}

export type EcNotificationRun = {
  id: string
  recipientType: 'customer' | 'operator'
  notificationName: string
  source: string
  sourceEventId: string
  friendId: string | null
  friendName: string | null
  orderNumber: string | null
  /** 実応答は migration 304 の CHECK どおり 'in_app' も返す。 */
  channel: 'line' | 'email' | 'in_app'
  status: 'pending' | 'accepted' | 'excluded' | 'failed'
  reason: string | null
  receivedAt: string
  acceptedAt: string | null
  attemptCount: number
  nextRetryAt: string | null
  clickedAt: string | null
  version: number | null
  /** 実応答は 'retry' / 'resend' / 'test' も返す。想定外値はそのまま扱う。 */
  executionMode: 'automatic' | 'manual' | 'retry' | 'resend' | 'test'
  retryAvailable: boolean
  recordVersion: number
  providerStatus: string | null
}

export type EcNotificationRunList = {
  items: EcNotificationRun[]
  summary: { accepted: number; failed: number; excluded: number; pending: number }
  coverage: {
    source: 'notification_delivery_ledger'
    unassignedHistoricalRowsExcluded: true
    attemptHistoryAvailable: true
    retryAvailable: true
  }
}

export type EcShipment = {
  id: string
  eventType: string
  eventLabel: string
  orderNumber: string | null
  friendId: string | null
  friendName: string | null
  /** 「鹿肉ミンチ × 2」のような一行。商品情報が無ければ空文字。 */
  items: string
  itemCount: number
  quantity: number
  /** JSTの暦日（YYYY-MM-DD）。 */
  shipDate: string
  /** subscription = EC側の予定日、ordered_at = 注文日時からの算出。 */
  shipDateSource: 'subscription' | 'ordered_at'
}

export type EcShipmentList = {
  today: string
  tomorrow: string
  soon: EcShipment[]
  later: EcShipment[]
  soonCount: number
  laterCount: number
  /**
   * 今日が出荷予定の総数。明細の limit で切る前の走査全件から数える（DASH-22）。
   * 段階配備中の旧Workerでは未返却。その場合は画面側が返った明細から数える。
   */
  todayCount?: number
  scanned: number
  scanLimit: number
}

export type EcNotificationSetting = {
  eventType: string
  label: string
  isEnabled: boolean
  title: string | null
  introText: string
  outroText: string
  category: 'order' | 'payment' | 'shipping' | 'support' | 'subscription'
  buttonLabel: string
  buttonUrl: string
  imageUrl: string
  displayOrder: number
  fixedFields: string[]
  fixedPreview: string
  updatedAt: string
}
