import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'

/**
 * F-25 人の予約の自動で合わせるルール（★V8-B wJYQb）。
 * Worker `apps/worker/src/routes/booking.ts`。
 */

export interface BookingAutoRules {
  excludeCalendarBlock: boolean
  writeBackToCalendar: boolean
  autoAssign: boolean
  mergeDuplicates: boolean
  conflictNotify: boolean
  unconnectedNotify: boolean
  dailyLimitNotify: boolean
}

export const bookingAutoRulesApi = {
  get: (accountId: string) =>
    fetchApi<ApiResponse<BookingAutoRules>>(`/api/booking/admin/auto-rules?account_id=${encodeURIComponent(accountId)}`),
  save: (accountId: string, rules: BookingAutoRules) =>
    fetchApi<ApiResponse<BookingAutoRules>>(
      `/api/booking/admin/auto-rules?account_id=${encodeURIComponent(accountId)}`,
      { method: 'PUT', body: JSON.stringify(rules) },
    ),
}
