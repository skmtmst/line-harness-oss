export type BroadcastPreflight = {
  audienceCount: number
  hiddenExcluded: number
  consentExcluded?: number
  warnings: Array<{ level: 'info' | 'warning'; message: string }>
  audience?: {
    matched: number
    sendable: number
    evaluatedAt: string
    representatives: Array<{
      friendId: string
      displayName: string | null
      pictureUrl: string | null
      summary: string
    }>
  }
  exclusions?: {
    blocked: number
    hidden: number
    missingDestination: number
    duplicate: number
    paused: number | null
    total: number
  }
  quota?: {
    monthlyUsed: number | null
    monthlyLimit: number | null
    remaining: number | null
    planned: number
    state: 'available' | 'insufficient' | 'unavailable'
    reason: string | null
  }
  concurrentBroadcasts?: Array<{ id: string; title: string; scheduledAt: string }>
  conditionAxes?: {
    standard: Array<{ key: string; label: string }>
    broadcastOnly: Array<{ key: string; label: string }>
  }
}
