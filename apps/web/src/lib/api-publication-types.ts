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

/** GET /api/accounts/health-summary の応答。ログ本文は含まない。 */
export type AccountHealthSummary = {
  items: Array<{ lineAccountId: string; riskLevel: string | null }>
  warningCount: number
  dangerCount: number
}

export type PhotoAssetRun = {
  id: string
  photoId: string
  lineAccountId: string
  requestedVersion: number
  status: 'queued' | 'processing' | 'completed' | 'failed'
  requestedBy: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
  operation?: 'review' | 'public' | 'thumbnail' | 'all'
}
