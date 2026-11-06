import { fetchApi } from '../transport/request'
import type { SavedSearchListResponse, SavedSearchDetail } from '../types/attributes'
import type { ApiResponse, SavedSearch, SavedSegmentPreset, SavedSegmentConditions } from '@line-crm/shared'
import type { SegmentCondition } from '../../segment-condition'

export const searchesMethods = {
/** 保存した検索。上限50件。 */
  savedSearches: {
    list: (accountId: string, params?: {
      owner?: 'all' | 'me'
      usage?: 'all' | 'used' | 'unused'
      match?: 'all' | 'matched' | 'zero'
      query?: string
      limit?: number
      cursor?: string
    }) => {
      const query = new URLSearchParams({ lineAccountId: accountId })
      if (params?.owner) query.set('owner', params.owner)
      if (params?.usage) query.set('usage', params.usage)
      if (params?.match) query.set('match', params.match)
      if (params?.query) query.set('query', params.query)
      if (params?.limit) query.set('limit', String(params.limit))
      if (params?.cursor) query.set('cursor', params.cursor)
      return fetchApi<SavedSearchListResponse>(`/api/saved-searches?${query}`)
    },
    detail: (id: string, accountId: string) =>
      fetchApi<ApiResponse<SavedSearchDetail>>(
        `/api/saved-searches/${id}?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    preview: (accountId: string, data: {
      savedSearchId?: string
      conditions?: unknown
      revision?: number
    }) => fetchApi<ApiResponse<SavedSearchDetail>>('/api/saved-searches/preview', {
      method: 'POST',
      body: JSON.stringify({ lineAccountId: accountId, ...data }),
    }),
    create: (data: {
      name: string
      accountId: string
      conditions: unknown
      isShared?: boolean
    }) =>
      fetchApi<ApiResponse<SavedSearch>>(`/api/saved-searches?lineAccountId=${encodeURIComponent(data.accountId)}`, {
        method: 'POST',
        body: JSON.stringify({ name: data.name, conditions: data.conditions, isShared: data.isShared }),
      }),
    update: (id: string, accountId: string, data: { name?: string; conditions?: unknown; isShared?: boolean; expectedRevision?: number; displayOrder?: number }) =>
      fetchApi<ApiResponse<SavedSearch>>(`/api/saved-searches/${id}?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /**
     * 動かせる検索だけの新しい順を1回で保存する（#1014 ATTR-02/03）。
     * 他人が作った検索や絞り込みで隠れた検索の位置はサーバー側で保つ。
     */
    reorder: (accountId: string, ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>(
        `/api/saved-searches/reorder?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'PATCH', body: JSON.stringify({ ids }) },
      ),
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(`/api/saved-searches/${id}?lineAccountId=${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
  },
/** 一斉配信などで再利用する共通の対象条件。旧い友だち検索とは形を混ぜない。 */
  segmentPresets: {
    list: (accountId: string) =>
      fetchApi<ApiResponse<SavedSegmentPreset[]>>(
        `/api/saved-searches?format=segment_v1&lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    create: (data: { name: string; accountId: string; condition: SegmentCondition; isShared?: boolean }) =>
      fetchApi<ApiResponse<SavedSegmentPreset>>(
        `/api/saved-searches?format=segment_v1&lineAccountId=${encodeURIComponent(data.accountId)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: data.name,
            conditions: {
              version: 1,
              condition: data.condition as SavedSegmentConditions['condition'],
            } satisfies SavedSegmentConditions,
            isShared: data.isShared,
          }),
        },
      ),
    update: (
      id: string,
      accountId: string,
      data: { name?: string; condition?: SegmentCondition; isShared?: boolean },
    ) =>
      fetchApi<ApiResponse<SavedSegmentPreset>>(
        `/api/saved-searches/${id}?format=segment_v1&lineAccountId=${encodeURIComponent(accountId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: data.name,
            conditions: data.condition
              ? ({
                  version: 1,
                  condition: data.condition as SavedSegmentConditions['condition'],
                } satisfies SavedSegmentConditions)
              : undefined,
            isShared: data.isShared,
          }),
        },
      ),
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(
        `/api/saved-searches/${id}?format=segment_v1&lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
      ),
  },
}
