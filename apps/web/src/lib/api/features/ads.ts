import { fetchApi } from '../transport/request'
import type { ApiResponse } from '@line-crm/shared'
import type { AdPlatform, AdConversionLog } from '../types/ads'

export const adsMethods = {
  adPlatforms: {
    retryLog: (id: string) => fetchApi<ApiResponse<import('@line-crm/shared').AdConversionRetryResult>>(
      `/api/ad-platforms/logs/${encodeURIComponent(id)}/retry`, { method: 'POST' },
    ),
    mappings: (accountId: string) => fetchApi<ApiResponse<import('@line-crm/shared').AdEventMapping[]>>(`/api/ad-platforms/mappings?account_id=${encodeURIComponent(accountId)}`),
    saveMapping: (pointId: string, data: import('@line-crm/shared').SaveAdEventMappingRequest) => fetchApi<ApiResponse<import('@line-crm/shared').AdEventMapping>>(`/api/ad-platforms/mappings/${encodeURIComponent(pointId)}`, { method: 'PUT', body: JSON.stringify(data) }),
    create: (data: {name: string;displayName?: string;lineAccountId: string;config: Record<string,unknown>}) => fetchApi<ApiResponse<AdPlatform>>('/api/ad-platforms',{method:'POST',body:JSON.stringify(data)}),
    update: (id: string,data: {config?: Record<string,unknown>;displayName?: string;isActive?: boolean}) => fetchApi<ApiResponse<AdPlatform>>(`/api/ad-platforms/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(data)}),
    connect: (id: string) => fetchApi<ApiResponse<import('@line-crm/shared').AdPlatformConnectResult>>(`/api/ad-platforms/${encodeURIComponent(id)}/connect`,{method:'POST'}),
    list: (lineAccountId?: string | null) =>
      fetchApi<ApiResponse<AdPlatform[]>>(`/api/ad-platforms${lineAccountId ? `?lineAccountId=${encodeURIComponent(lineAccountId)}` : ''}`),
    logsPage: (params?: { page?: number; limit?: number; status?: string; query?: string; lineAccountId?: string | null }) => {
      const query = new URLSearchParams()
      query.set('page', String(params?.page ?? 1))
      query.set('limit', String(params?.limit ?? 20))
      if (params?.status && params.status !== 'all') query.set('status', params.status)
      if (params?.query?.trim()) query.set('query', params.query.trim())
      if (params?.lineAccountId) query.set('lineAccountId', params.lineAccountId)
      return fetchApi<ApiResponse<{
        items: AdConversionLog[]
        total: number
        page: number
        limit: number
        summary: {
          sentLast30Days: number
          pendingLast30Days: number
          failedLast30Days: number
        }
        sort: Array<{ field: string; direction: 'asc' | 'desc' }>
      }>>(`/api/ad-platforms/logs?${query.toString()}`)
    },
    logs: (id: string, limit = 20) =>
      fetchApi<ApiResponse<AdConversionLog[]>>(`/api/ad-platforms/${id}/logs?limit=${limit}`),
    /** #818: その連携の前日分の広告費をいま取り込む */
    importCost: (id: string) =>
      fetchApi<ApiResponse<{ status: 'success' | 'failed' | 'skipped' }>>(
        `/api/ad-platforms/${id}/cost-import`,
        { method: 'POST' },
      ),
  },
/**
   * #818: 流入元ごとの広告費の台帳。
   * 取込分と手入力分を同じ一覧で返し、手入力分は source が 'manual'。
   */
  adCosts: {
    list: (params?: { accountId?: string; from?: string; to?: string }) => {
      const query = new URLSearchParams()
      if (params?.accountId) query.set('accountId', params.accountId)
      if (params?.from) query.set('from', params.from)
      if (params?.to) query.set('to', params.to)
      const suffix = query.size > 0 ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<{
        conversionCost?: import('@line-crm/shared').AdConversionCostSummary
        rows: Array<{
          sourceLabel: string
          adPlatformId: string | null
          entryRouteId: string | null
          source: 'import' | 'manual'
          totals: Array<{ currency: string; amountMinor: number }>
          friendAdds: number | null
          costPerFriendMinor: number | null
          lastImportedAt: string | null
        }>
        platforms: Array<{
          id: string
          name: string
          displayName: string | null
          lastSuccessAt: string | null
          lastRunStatus: 'success' | 'failed' | null
          lastRunAt: string | null
          lastError: string | null
        }>
        /** R275: 手入力の記録は1行ずつ返す。取消済みも履歴として出す。 */
        manualEntries?: Array<{
          id: string
          sourceLabel: string
          day: string
          amountMinor: number
          currency: string
          entryRouteId: string | null
          cancelledAt: string | null
          cancelReason: string | null
          createdAt: string
        }>
      }>>(`/api/ad-costs${suffix}`)
    },
    create: (data: {
      lineAccountId?: string
      sourceLabel: string
      entryRouteId?: string
      day: string
      amountMinor: number
      currency?: string
    }) =>
      fetchApi<ApiResponse<unknown>>('/api/ad-costs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // R275: 手入力で間違えて入れた費用を集計から外す。行は残り、理由が必須。
    cancel: (id: string, reason: string) =>
      fetchApi<ApiResponse<{ id: string }>>(
        `/api/ad-costs/${encodeURIComponent(id)}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
  },
}
