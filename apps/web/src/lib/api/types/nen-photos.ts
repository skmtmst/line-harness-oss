import type { PhotoAssetRun } from './publication-types'

export type PhotoReviewMetrics = {
  pendingCount: number
  reviewedCount: number
  averageReviewMinutes: number | null
  oldestPendingAt: string | null
  attentionCount: number
}

/**
 * 写真1枚の審査履歴（Issue #1040 IDEA-22）。
 * GET /api/nen-members/photos/:id の `history` に入る。差戻し理由・
 * 付与ポイント・担当・通知結果まで追える。
 */
export type NenPhotoReviewHistoryEntry = {
  to_status: 'adopted' | 'rejected'
  reason_code: string | null
  reason_note: string | null
  awarded_points: number
  reviewed_by_name: string | null
  notification_status: string | null
  created_at: string
}

/**
 * 採用に連動するポイント付与の実状態（Issue #1040 IDEA-22）。
 * outbox の行をそのまま返す。無い写真は null（EC未連携など付与対象外）。
 */
/**
 * 採用写真のポイント手続きの運用向け状態（PHOTO-06）。
 * DBのstatusとは別にサーバーが派生して返す:
 *   stale             … pending/processing のまま24時間以上更新なし
 *   failed_retryable  … 失敗したが再試行で進められる
 *   failed_permanent  … 再試行しても直らない（会員連携解除など）
 */
export type NenPhotoRewardDisplayState =
  'pending' | 'stale' | 'synced' | 'failed_retryable' | 'failed_permanent'

export type NenPhotoRewardState = {
  status: 'pending' | 'processing' | 'synced' | 'failed'
  state?: NenPhotoRewardDisplayState
  points: number
  attempt_count: number
  last_error: string | null
  next_attempt_at?: string | null
  synced_at: string | null
  updated_at: string
  reason_label?: string | null
}

/** point-retry / point-reconcile の応答（PHOTO-06）。 */
export type NenPhotoRewardActionResult = {
  action: 'retry' | 'reconcile'
  state: NenPhotoRewardDisplayState
  synced: boolean
  duplicate: boolean
  reason: string | null
  reasonLabel: string | null
}

/** 掲載先1件。active=0 の外した先も removed_at つきで残る（Issue #1040）。 */
/**
 * GET /api/nen-members/photos/publications の応答本体（Issue #1040）。
 * `pendingWithdrawals` は同意撤回済みで掲載先の整理が残るもの、
 * `withdrawnItems` は外し終えた履歴。撤回後に残る公開先を追うための口。
 */
export type NenPhotoPublicationList = {
  summary: {
    publishedCount: number
    placementCount: number
    topPhoto: Record<string, unknown> | null
    topPhoto30Days?: (Record<string, unknown> & import('@line-crm/shared').PublicationThirtyDayCount) | null
    consentedCount: number
    attentionCount: number
    withdrawnCount: number
  }
  items: Array<Record<string, unknown>>
  pendingWithdrawals: Array<Record<string, unknown>>
  withdrawnItems: Array<Record<string, unknown>>
}

export type NenPhotoPublicationPlacement = {
  id: string
  publication_id?: string
  placement_type: string
  placement_label: string
  view_count: number | null
  active: number | null
  created_at?: string | null
  removed_at?: string | null
}

/** 掲載管理・詳細で使う掲載1件分。掲載先は外したものも含む。 */
export type NenPhotoPublicationRecord = {
  id: string
  photo_id?: string
  status: 'published' | 'withdrawn'
  view_count: number | null
  view_count_30_days?: number | null
  version?: number
  published_at: string | null
  withdrawn_at: string | null
  withdrawn_by_name?: string | null
  placements?: NenPhotoPublicationPlacement[]
}

/** GET /api/nen-members/photos/:id の応答本体。 */
/**
 * #817: 同じ中身の写真で、すでに採用されて報酬が付いた前の投稿。
 * 詳細口が返す。無ければ null。
 */
export type NenPhotoDuplicate = {
  photoId: string
  imageUrl: string
  petName: string
  createdAt: string
  awardedPoints: number
}

/** #817: 採用する時点で使っている報酬の決まり（版の写し）。 */
export type PhotoRewardPolicyInfo = {
  versionNumber: number
  policyKey: string
  points: number
}

export type NenPhotoDetail = Record<string, unknown> & {
  history?: NenPhotoReviewHistoryEntry[]
  reward?: NenPhotoRewardState | null
  publication?: NenPhotoPublicationRecord | null
  duplicate?: NenPhotoDuplicate | null
  rewardPolicy?: PhotoRewardPolicyInfo | null
}

/** #817: 報酬の決まりの版の1行。 */
export type PhotoRewardPolicyVersion = {
  publicationPoints?: number
  versionNumber: number
  policyKey: string
  points: number
  summary: string
  effectiveFrom: string | null
  createdBy: string | null
  createdAt: string
  status: 'in_use' | 'reserved' | 'past'
}

export type PhotoAssetStatus = {
  reviewVersion: number
  jobs: PhotoAssetRun[]
}

export type PhotoDerivatives = {
  reviewVersion: number
  items: Array<{
    kind: string
    sourceVersion: number
    objectKey: string
    contentType: string
    byteSize: number | null
    width: number | null
    height: number | null
    createdAt: string
  }>
  knownUrls: Array<{ kind: string; url: string; sourceVersion: number }>
}

export type PhotoBulkDecision = {
  photoId: string
  decision: 'approve' | 'return' | 'reject'
  expectedVersion: number
  reasonCode: 'quality' | 'privacy' | 'unrelated' | 'duplicate' | 'other' | null
  reasonNote: string | null
}

export type PhotoBulkReviewResult = {
  updatedCount: number
  items: Array<{
    photoId: string
    decision: 'approve' | 'return' | 'reject'
    reviewVersion: number
    decisionId: string
    notificationStatus: 'sent' | 'failed'
    notificationError?: string
  }>
  notificationFailures: Array<{ photoId: string; error: string }>
  reconciled?: boolean
}
