import type {
  FriendListParams,
  FriendListItem,
  FriendDetail,
  FriendFormSubmission,
  FriendUpcoming,
} from '../types/friends'
import { fetchApi } from '../transport/request'
import type {
  ApiResponse,
  PaginatedResponse,
  FriendSummary,
  FriendBulkSelection,
  FriendBulkOperation,
  FriendBulkPreview,
  FriendBulkRunSummary,
  FriendBulkRunDetail,
} from '@line-crm/shared'
import type {
  MileageSummary,
  MileageHistoryItem,
  MileageSelfInsights,
  MileageConnectedAccount,
} from '../types/mileage'

export const friendsMethods = {
  friends: {
    list: (params?: FriendListParams) => {
      const query: Record<string, string> = {}
      if (params?.pagination) query.pagination = params.pagination
      if (params?.cursor) query.cursor = params.cursor
      if (params?.offset) query.offset = String(params.offset)
      if (params?.limit) query.limit = String(params.limit)
      if (params?.tagId) query.tagId = params.tagId
      if (params?.accountId) query.lineAccountId = params.accountId
      if (params?.audienceId) query.audienceId = params.audienceId
      if (params?.search) query.search = params.search
      if (params?.includeTags === false) query.includeTags = 'false'
      if (params?.includeChatStatus) query.includeChatStatus = 'true'
      if (params?.fieldColumns?.length) query.fieldColumns = JSON.stringify(params.fieldColumns)
      if (params?.sort) query.sort = params.sort
      if (params?.handled) query.handled = params.handled
      if (params?.operatorId) query.operatorId = params.operatorId
      if (params?.scenarioId) query.scenarioId = params.scenarioId
      if (params?.savedSearchId) query.savedSearchId = params.savedSearchId
      if (params?.conditions) query.conditions = JSON.stringify(params.conditions)
      if (params?.tagIds?.length) query.tagIds = params.tagIds.join(',')
      if (params?.excludeTagIds?.length) query.excludeTagIds = params.excludeTagIds.join(',')
      if (params?.statusMessage) query.statusMessage = params.statusMessage
      if (params?.createdFrom) query.createdFrom = params.createdFrom
      if (params?.createdTo) query.createdTo = params.createdTo
      if (params?.chatStatus) query.chatStatus = params.chatStatus
      if (params?.visibility) query.visibility = params.visibility
      if (params?.scoreMin !== undefined) query.scoreMin = String(params.scoreMin)
      if (params?.scoreMax !== undefined) query.scoreMax = String(params.scoreMax)
      if (params?.scoredOnly) query.scoredOnly = '1'
      for (const [k, v] of Object.entries(params?.metadata ?? {})) {
        if (k && v) query[`metadata.${k}`] = v
      }
      for (const [k, v] of Object.entries(params?.metadataNot ?? {})) {
        if (k && v) query[`metadataNot.${k}`] = v
      }
      return fetchApi<ApiResponse<PaginatedResponse<FriendListItem> & { nextCursor?: string | null }>>(
        '/api/friends?' + new URLSearchParams(query)
      )
    },
    get: (id: string, options?: { includeSubmissions?: boolean }) => {
      const query = options?.includeSubmissions === false ? '?submissions=0' : ''
      return fetchApi<ApiResponse<FriendDetail>>(`/api/friends/${id}${query}`)
    },
    /*
     * PERF-13: フォーム回答履歴のカーソル式取得。
     * 詳細の初期応答には本文を同梱せず、回答タブを開いたときに
     * こちらで取る。nextCursor で10件より古い回答へ遡れる。
     */
    formSubmissions: (id: string, params?: { cursor?: string | null; limit?: number }) => {
      const query = new URLSearchParams()
      if (params?.cursor) query.set('cursor', params.cursor)
      if (params?.limit) query.set('limit', String(params.limit))
      const suffix = query.size ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<{
        items: FriendFormSubmission[]
        total: number | null
        nextCursor: string | null
      }>>(`/api/friends/${encodeURIComponent(id)}/form-submissions${suffix}`)
    },
    /**
     * 受信箱の顧客情報に出す「次の予定」（IDEA-02）。
     * 値が null = 予定なし、*_Error=true = 取得失敗（未取得）を区別する。
     */
    summary: (id: string) =>
      fetchApi<ApiResponse<FriendSummary>>(`/api/friends/${encodeURIComponent(id)}/summary`),
    upcoming: (id: string) =>
      fetchApi<ApiResponse<FriendUpcoming>>(`/api/friends/${id}/upcoming`),
    mileage: (id: string, params?: number | { limit?: number; accountId?: string }) => {
      const query = new URLSearchParams()
      const options = typeof params === 'number' ? { limit: params } : params
      query.set('limit', String(options?.limit ?? 10))
      if (options?.accountId) query.set('accountId', options.accountId)
      return fetchApi<ApiResponse<{
        summary: MileageSummary
        history: MileageHistoryItem[]
        insights: MileageSelfInsights
        connections: MileageConnectedAccount[]
      }>>(
          `/api/friends/${id}/mileage?${query.toString()}`,
        )
    },
    /**
     * 友だち追加の内訳（設計 V2 4-6）。
     * returning は「以前からのお客さまに『はじめまして』が届いた数」でもある。
     */
    addBreakdown: (params?: { days?: number; accountId?: string }) => {
      const q = new URLSearchParams()
      if (params?.days) q.set('days', String(params.days))
      if (params?.accountId) q.set('lineAccountId', params.accountId)
      const tail = q.toString() ? `?${q.toString()}` : ''
      return fetchApi<
        ApiResponse<{ days: number; firstTime: number; returning: number; unblocked: number }>
      >(`/api/friends/add-breakdown${tail}`)
    },
    count: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<{ count: number }>>('/api/friends/count' + query)
    },
    bulkPreview: (selection: FriendBulkSelection, operation: FriendBulkOperation) =>
      fetchApi<ApiResponse<FriendBulkPreview>>('/api/friends/bulk-runs/preview', {
        method: 'POST',
        body: JSON.stringify({ selection, operation }),
      }),
    bulkCreate: (
      selection: FriendBulkSelection,
      operation: FriendBulkOperation,
      options: { idempotencyKey: string; scheduledAt?: string; confirmIrreversible?: boolean },
    ) =>
      fetchApi<ApiResponse<FriendBulkRunSummary>>('/api/friends/bulk-runs', {
        method: 'POST',
        headers: {
          'Idempotency-Key': options.idempotencyKey,
          ...(options.confirmIrreversible ? { 'X-Confirm-Irreversible': 'friend-bulk-run' } : {}),
        },
        body: JSON.stringify({ selection, operation, scheduledAt: options.scheduledAt }),
      }),
    bulkGet: (id: string, options?: { page?: number; limit?: number }) => {
      const query = new URLSearchParams()
      if (options?.page) query.set('page', String(options.page))
      if (options?.limit) query.set('limit', String(options.limit))
      const tail = query.size ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<FriendBulkRunDetail>>(`/api/friends/bulk-runs/${id}${tail}`)
    },
    bulkRetry: (id: string) =>
      fetchApi<ApiResponse<{ retriedCount: number }>>(`/api/friends/bulk-runs/${id}/retry`, {
        method: 'POST',
      }),
    bulkUndo: (id: string, idempotencyKey: string) =>
      fetchApi<ApiResponse<FriendBulkRunSummary>>(`/api/friends/bulk-runs/${id}/undo`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    /**
     * 友だち情報（metadata）を書き換える。
     * 渡した項目だけ変わる。null を渡すとその項目を削除する。
     */
    updateMetadata: (id: string, metadata: Record<string, string | null>) =>
      fetchApi<ApiResponse<unknown>>(`/api/friends/${id}/metadata`, {
        method: 'PUT',
        body: JSON.stringify(metadata),
      }),
    addTag: (friendId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${friendId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
      }),
    removeTag: (friendId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${friendId}/tags/${tagId}`, {
        method: 'DELETE',
      }),
    richMenu: (id: string) =>
      fetchApi<ApiResponse<{ id: string | null; name: string | null; isDefault: boolean }>>(
        `/api/friends/${id}/rich-menu`,
      ),
  },
}
