import type {
  IdentityCandidateKind,
  IdentityCandidateStatus,
  ApiResponse,
  IdentityCandidateList,
  IdentityCandidateDetail,
  DecideIdentityCandidateRequest,
  UndoIdentityCandidateRequest,
  DetectIdentityCandidatesResult,
  UpdateMergedPersonRequest,
  MergedPersonDetail,
  UpdateMergedPersonDeliveryPrioritiesRequest,
  SavedSearchConditions,
} from '@line-crm/shared'
import { fetchApi } from '../transport/request'
import type {
  IdentityCandidateWithProfiles,
  MergedPersonWithCandidates,
  UpdateMergedProfileCandidatesRequest,
  FriendSavedView,
} from '../types/friends'
import type { FetchApiOptions } from '../types/transport'

export const identityMethods = {
/**
   * 本人照合の候補。3-2-A（友だち同士）と 23-1-A（ECの会員）が同じ口を読む。
   *
   * 判定と取り消しは、画面が読み込んだ版（`expectedVersion`）を必ず送る。
   * 先に別の人が判定していれば Worker が 409 `STALE_CANDIDATE` を返すので、
   * 画面は上書きせず読み直しを促す。
   */
  identityCandidates: {
    list: (params: {
      kind: IdentityCandidateKind
      /** 'all' は状態で絞らない（FRIEND-11。「すべて」が pending だけを見せていた）。 */
      status?: IdentityCandidateStatus | 'all'
      lineAccountId?: string
      limit?: number
      offset?: number
      /** FRIEND-11: 名前・根拠の検索語。サーバー側で全件へかける。 */
      q?: string
    }) => {
      const query = new URLSearchParams({ kind: params.kind })
      if (params.status) query.set('status', params.status)
      if (params.lineAccountId) query.set('lineAccountId', params.lineAccountId)
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
      if (params.q) query.set('q', params.q)
      return fetchApi<ApiResponse<IdentityCandidateList>>(`/api/identity-candidates?${query.toString()}`)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<IdentityCandidateDetail>>(
        `/api/identity-candidates/${encodeURIComponent(id)}`,
      ),
    decide: (id: string, body: DecideIdentityCandidateRequest) =>
      fetchApi<ApiResponse<IdentityCandidateDetail>>(
        `/api/identity-candidates/${encodeURIComponent(id)}/decide`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    undo: (id: string, body: UndoIdentityCandidateRequest) =>
      fetchApi<ApiResponse<IdentityCandidateDetail>>(
        `/api/identity-candidates/${encodeURIComponent(id)}/undo`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    detectFriendDuplicates: (params?: { limit?: number; after?: string | null }) => {
      const query = new URLSearchParams({ kind: 'friend_duplicate' })
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.after) query.set('after', params.after)
      return fetchApi<ApiResponse<DetectIdentityCandidatesResult>>(
        `/api/identity-candidates/detect?${query.toString()}`,
        { method: 'POST' },
      )
    },
    getFriendDuplicate: (id: string) =>
      fetchApi<ApiResponse<IdentityCandidateWithProfiles>>(
        `/api/friends/duplicates/${encodeURIComponent(id)}`,
      ),
    decideFriendDuplicate: (id: string, body: DecideIdentityCandidateRequest) =>
      fetchApi<ApiResponse<IdentityCandidateWithProfiles>>(
        `/api/friends/duplicates/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
  },
/**
   * 統合ユーザーの詳細（設計 `w8W4Eh` 3-3-A）。
   *
   * 更新は**読み込んだ `revision` を必ず送る**。先に別の人が変えていれば
   * Worker が 409 `STALE_PERSON` を返すので、画面は上書きせず読み直す。
   *
   * 解除は元の友だちと履歴を残す専用のDELETE契約を使う。
   */
  mergedPeople: {
    get: (id: string) =>
      fetchApi<ApiResponse<MergedPersonWithCandidates>>(
        `/api/friends/people/${encodeURIComponent(id)}`,
      ),
    update: (id: string, body: Omit<UpdateMergedPersonRequest, 'profileSelections'>) =>
      fetchApi<ApiResponse<MergedPersonDetail>>(
        `/api/friends/people/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
    updateProfileValues: (id: string, body: UpdateMergedProfileCandidatesRequest) =>
      fetchApi<ApiResponse<MergedPersonWithCandidates>>(
        `/api/friends/people/${encodeURIComponent(id)}/profile-values`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
    updateDeliveryPriorities: (
      id: string,
      body: UpdateMergedPersonDeliveryPrioritiesRequest,
    ) =>
      fetchApi<ApiResponse<MergedPersonDetail>>(
        `/api/friends/people/${encodeURIComponent(id)}/delivery-priorities`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
    unlink: (id: string, friendId: string, body: { expectedRevision: number; reason: string }) =>
      fetchApi<ApiResponse<MergedPersonDetail>>(
        `/api/friends/people/${encodeURIComponent(id)}/links/${encodeURIComponent(friendId)}`,
        { method: 'DELETE', body: JSON.stringify(body) },
      ),
  },
  friendSavedViews: {
    list: (accountId: string, options?: FetchApiOptions) =>
      fetchApi<ApiResponse<{ items: FriendSavedView[]; total: number }>>(
        `/api/friends/saved-views?lineAccountId=${encodeURIComponent(accountId)}`,
        options,
      ),
    create: (accountId: string, body: { name: string; conditions: SavedSearchConditions; isShared?: boolean }) =>
      fetchApi<ApiResponse<FriendSavedView>>(
        `/api/friends/saved-views?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
  },
  duplicates: {
    stats: (options?: { forceRefresh?: boolean }) =>
      fetchApi<ApiResponse<{
        totalFollowing: number;
        uniquePeople: number;
        friendDups: number;
        duplicateGroups: number;
        wastedPerBroadcastYen: number;
        msgUnitYen: number;
        perAccount: Array<{
          accountId: string;
          accountName: string;
          friends: number;
          dups: number;
          dupRate: number;
        }>;
        // Optional during rolling deploys when an older worker is live.
        pairwiseOverlap?: Array<{
          fromAccountId: string;
          toAccountId: string;
          overlap: number;
        }>;
        // Optional during rolling deploys when an older worker is live.
        computedAt?: string;
      }>>(options?.forceRefresh ? '/api/duplicates/stats?refresh=1' : '/api/duplicates/stats'),
  },
}
