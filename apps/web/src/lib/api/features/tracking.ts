import { fetchApi } from '../transport/request'
import type { ApiResponse } from '@line-crm/shared'
import { rangeQuery } from '../query'
import type { MeasurementSite } from '../types/conversions'

export const trackingMethods = {
/** サイトスクリプト。自社サイトの行動を友だちに紐づける。 */
  siteTracking: {
    /** 計測が動いているかと、その内訳 */
    summary: (accountId?: string) =>
      fetchApi<
        ApiResponse<{
          todayEvents: number
          todayPageViews: number
          linkedEvents: number
          unlinkedEvents: number
          pathCount: number
          eventTypeCount: number
          lastEventAt: string | null
          /** #818: 同意した割合と、同意がなくて数えなかった件数 */
          consent: {
            granted: number
            declined: number
            suppressed: number
            grantedRate: number | null
          }
        }>
      >(`/api/site/summary${rangeQuery({ accountId })}`),
    pages: (params?: { from?: string; to?: string; accountId?: string }) =>
      fetchApi<ApiResponse<Array<{ host: string | null; path: string; views: number; visitors: number }>>>(
        `/api/site/pages${rangeQuery(params)}`,
      ),
    /**
     * 選択中アカウントの計測鍵。サイトに貼るコードの data-key に埋める。
     * accountId を省くと可視アカウントが1つだけのときだけ鍵が返る
     * (複数あるときは 400)。鍵は公開識別子で、帰属の分離にだけ使う。
     */
    trackingKey: (accountId?: string) =>
      fetchApi<ApiResponse<{ accountId: string; trackingKey: string }>>(
        accountId
          ? `/api/site/tracking-key?account_id=${encodeURIComponent(accountId)}`
          : '/api/site/tracking-key',
      ),
    friendEvents: (friendId: string) =>
      fetchApi<
        ApiResponse<
          Array<{
            id: string
            eventType: string
            host: string | null
            path: string | null
            label: string | null
            occurredAt: string
          }>
        >
      >(`/api/friends/${friendId}/site-events`),
  },
/**
   * #819: 計測サイト。成果を数えてよいドメインをサイトごとに決める。
   * サイトIDは公開識別子で、秘密の鍵はタグに埋め込まない。
   */
  measurementSites: {
    list: (accountId?: string) =>
      fetchApi<ApiResponse<MeasurementSite[]>>(
        `/api/measurement-sites${rangeQuery({ accountId })}`,
      ),
    create: (data: { accountId?: string; label: string; domains: string[] }) =>
      fetchApi<ApiResponse<{ id: string; label: string; domains: string[] }>>(
        '/api/measurement-sites',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    update: (id: string, data: { label?: string; domains?: string[] }) =>
      fetchApi<ApiResponse<{ id: string }>>(
        `/api/measurement-sites/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(data) },
      ),
    // 計測を止める・再開する。止めるときは理由が必須で、履歴は残る。
    stop: (id: string, reason: string) =>
      fetchApi<ApiResponse<{ id: string }>>(
        `/api/measurement-sites/${encodeURIComponent(id)}/stop`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    resume: (id: string) =>
      fetchApi<ApiResponse<{ id: string }>>(
        `/api/measurement-sites/${encodeURIComponent(id)}/resume`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
  },
  funnels: {
    list: (accountId: string) =>
      fetchApi<ApiResponse<Array<{ id: string; name: string; windowDays: number; createdAt: string }>>>(
        `/api/funnels?account_id=${encodeURIComponent(accountId)}`,
      ),
    create: (accountId: string, data: {
      name: string
      windowDays?: number
      steps: Array<{ label: string; kind: string; match: unknown }>
    }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/funnels?account_id=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (accountId: string, id: string) => fetchApi<ApiResponse<null>>(
      `/api/funnels/${id}?account_id=${encodeURIComponent(accountId)}`,
      { method: 'DELETE' },
    ),
    result: (accountId: string, id: string, params?: { from?: string; to?: string }) =>
      fetchApi<
        ApiResponse<{
          funnel: { id: string; name: string }
          steps: Array<{
            stepOrder: number
            label: string
            reached: number
            conversionFromPrevious: number
          }>
        }>
      >(`/api/funnels/${id}/result${rangeQuery({ ...params, accountId })}`),
  },
// tracked_links は別管理だが /inflow-links 一覧で「(未登録)」誤表示を防ぐため
  // 同ページから参照する。Worker の applyRefAttribution は entry_routes → tracked_links
  // の順でフォールバックするので、tracked_links 登録済み ref は実際にはシナリオ発火している。
  trackedLinks: {
    list: (accountId?: string) =>
      fetchApi<
        ApiResponse<
          Array<{
            id: string
            name: string
            originalUrl: string
            trackingUrl: string
            tagId: string | null
            scenarioId: string | null
            introTemplateId: string | null
            rewardTemplateId: string | null
            isActive: boolean
            clickCount: number
            createdAt: string
            updatedAt: string
          }>
        >
      >(`/api/tracked-links${accountId ? `?lineAccountId=${encodeURIComponent(accountId)}` : ''}`),
  },
}
