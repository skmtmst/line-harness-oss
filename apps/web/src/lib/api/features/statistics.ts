import { fetchApi } from '../transport/request'
import type { ApiResponse } from '@line-crm/shared'
import type { InboxStats, ListStats, BroadcastStats, FriendStats } from '../types/statistics'

export const statisticsMethods = {
  chatStats: {
    get: () => fetchApi<ApiResponse<InboxStats>>('/api/chats/stats'),
  },
  listStats: {
    get: (accountId?: string) => fetchApi<ApiResponse<ListStats>>(
      `/api/list-stats${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`,
    ),
  },
  broadcastStats: {
    get: () => fetchApi<ApiResponse<BroadcastStats>>('/api/broadcasts/stats'),
  },
  friendStats: {
    get: (accountId?: string) =>
      fetchApi<ApiResponse<FriendStats>>(
        `/api/friends/stats${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`,
      ),
  },
  operators: {
    list: () =>
      fetchApi<ApiResponse<Array<{ id: string; name: string }>>>('/api/operators'),
  },
}
