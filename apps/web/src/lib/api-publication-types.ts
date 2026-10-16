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
