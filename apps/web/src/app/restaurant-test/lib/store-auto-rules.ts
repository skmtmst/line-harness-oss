import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'

/**
 * F-24 飲食店の自動で合わせるルール（★V8-B nGcY1・店ごと）。
 * Worker `apps/worker/src/routes/restaurant-test.ts`。
 */

export type StoreAutoAction = 'stop' | 'reduce' | 'keep'

export interface StoreAutoRules {
  autoTableAssign: boolean
  recountSeats: boolean
  mergeDuplicates: boolean
  lowSeatThreshold: number
  lineAction: StoreAutoAction
  walkinAction: StoreAutoAction
  closeBanner: boolean
  lineNotifyManager: boolean
  conflictNotify: boolean
}

export const storeAutoRulesApi = {
  get: (storeId: string, accountId: string) =>
    fetchApi<ApiResponse<StoreAutoRules>>(
      `/api/restaurant-test/stores/${encodeURIComponent(storeId)}/auto-rules?account_id=${encodeURIComponent(accountId)}`,
    ),
  save: (storeId: string, accountId: string, rules: StoreAutoRules) =>
    fetchApi<ApiResponse<StoreAutoRules>>(
      `/api/restaurant-test/stores/${encodeURIComponent(storeId)}/auto-rules?account_id=${encodeURIComponent(accountId)}`,
      { method: 'PUT', body: JSON.stringify(rules) },
    ),
}
