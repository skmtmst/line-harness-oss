import { fetchApi } from '@/lib/api'
import type { BroadcastBubble } from '@line-crm/shared'

/*
 * G1 A/B テストの口（要件 G1-ab-test §3 の案）。本物は Codex の gap2 が作る途中なので、
 * 同じ道・同じ形の関数を画面側に置く（撮影は scripts/visual-qa/mock-api.mjs の見本）。
 * gap2 が lib に関数を足したら、この file はそれに置き換えて消す。
 */

export type AbMetric = 'click' | 'booking' | 'purchase'
export type AbUndecided = 'stop' | 'send_a'
export type AbStatus = 'draft' | 'testing' | 'decided' | 'undecided' | 'finished' | 'expired'

export type AbSettings = {
  testRatioPct: 10 | 20 | 30 | 50
  metric: AbMetric
  decideAfterMinutes: number
  undecidedPolicy: AbUndecided
}

export type AbVariantResult = {
  key: 'A' | 'B'
  label?: string | null
  sent: number
  failed: number
  clicks: number | null
  clickRate: number | null
  bookings: number | null
  purchases: number | null
  purchaseAmount: number | null
}

export type AbResult = {
  status: AbStatus
  metric: AbMetric
  decideAfterMinutes: number
  variants: AbVariantResult[]
  winner: 'A' | 'B' | null
  confidence: number | null
  decideAt: string | null
  /** 決められないとき、選ぶ期限（24 時間）。 */
  chooseUntil?: string | null
  /** 決められなかったため A を送った（決まらないとき＝A を送る）。 */
  fallback?: boolean
  remainder: { count: number; scheduledAt: string | null; sentAt: string | null }
}

type Result<T> = { success: true; data: T }
const write = (method: string, body: unknown, headers?: Record<string, string>) => ({ method, body: JSON.stringify(body), ...(headers ? { headers } : {}) })

export const broadcastAbApi = {
  saveTest: (broadcastId: string, body: AbSettings & { expectedVersion?: number }) =>
    fetchApi<Result<{ version: number }>>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/ab-test`, write('PUT', body)),
  removeTest: (broadcastId: string) =>
    fetchApi<Result<{ removed: true }>>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/ab-test`, { method: 'DELETE' }),
  saveVariant: (broadcastId: string, key: 'A' | 'B', messages: BroadcastBubble[]) =>
    fetchApi<Result<{ version: number }>>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/variants/${key}`, write('PUT', { messages })),
  result: (broadcastId: string) =>
    fetchApi<Result<AbResult | null>>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/ab-result`),
  choose: (broadcastId: string, variant: 'A' | 'B' | 'none', confirmedRecipientCount: number, idempotencyKey: string) =>
    fetchApi<Result<{ status: AbStatus }>>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/ab-test/choose`, write('POST', { variant, confirmedRecipientCount }, { 'Idempotency-Key': idempotencyKey })),
}
