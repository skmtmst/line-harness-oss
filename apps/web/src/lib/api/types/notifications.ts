import type { NotificationRule, CustomerNotificationFailureCounts } from '@line-crm/shared'

/** 一覧集計で返す、公開中の自動応答2件の競合ペア。 */
export type AutoReplyConflictPair = {
  leftAutoReplyId: string
  rightAutoReplyId: string
  winnerAutoReplyId: string
  certainty: 'certain' | 'possible'
  reason: string
}

export type OperatorNotificationRule = NotificationRule & {
  status: 'draft' | 'published'
  recipientCount: number
  lineRecipientCount: number
  occurredToday: number
  acceptedToday: number
  excludedToday: number
  lastOccurredAt: string | null
}

export type OperatorRecipientPreviewItem = {
  id: string
  name: string
  lineLinked: boolean
  emailVerified: boolean
  channels: { line: boolean; email: boolean; dashboard: boolean }
  canReceive: boolean
}

export type OperatorRecipientPreview = {
  items: OperatorRecipientPreviewItem[]
  summary: {
    staff: number
    canReceive: number
    line: number
    email: number
    dashboard: number
    unavailable: number
  }
}

export type OperatorDeliveryResult = {
  accepted: number
  excluded: number
  failed: number
  duplicate: number
}

export type LineNotificationDefinition = {
  id: string
  lineAccountId: string
  key: string
  name: string
  category: string
  sourceEventType: string
  status: 'draft' | 'published' | 'stopped'
  draft: Record<string, unknown>
  currentVersionId: string | null
  currentVersionNumber: number | null
  transactionalOnly: true
  version: number
  updatedAt: string
}

export type LineNotificationMetric = {
  definitionId: string
  notificationName: string
  accepted: { value: number }
  displayed: { state: 'available' | 'unavailable' | 'pending'; value: number | null; reason: string | null }
  clicked: { value: number }
}

export type LineNotificationMetrics = {
  items: LineNotificationMetric[]
  coverage: {
    individualOpenAvailable: false
    lineAggregateOnly: true
    unavailableIsNull: true
  }
}

/**
 * 顧客へのお知らせの送信件数。Workerが共通送信台帳の受け付け済みから
 * JSTの今日・この30日で数えたもの。ECの取り込み件数でもLINE集計の
 * 全期間合計でもない。
 */
export type LineNotificationSendCounts = {
  failures: CustomerNotificationFailureCounts
  sentToday: number
  sentLast30d: number
  byEventType: Array<{ eventType: string; today: number; last30d: number }>
  period: { today: string; from30d: string; to: string }
}
