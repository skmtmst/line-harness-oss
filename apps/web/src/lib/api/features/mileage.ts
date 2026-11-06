import { fetchApiBlob } from '../transport/download'
import { fetchApi } from '../transport/request'
import type { ApiResponse, MileageHistoryKind, MileageHistoryTypeFilter } from '@line-crm/shared'
import type {
  MileageRewardSummary,
  MileageRewardDraftInput,
  MileageRewardTestResult,
  MileageRewardAdminOverview,
  MileageAdminOverview,
  MileageFriendsV6Overview,
  MileageEarningRulesV6Overview,
  MileageEarningRuleDraftV6,
  MileageHistoryItem,
  MileageAdminHistory,
  MileageAdjustmentPolicy,
  MileageAdjustmentResult,
  MileageAdjustmentApprovalResult,
  MileageAdjustmentApprovalRequest,
  MileageEarningRuleTestResult,
  MileageRule,
} from '../types/mileage'

export const mileageMethods = {
  mileage: {
    exportCsv: (accountId: string, kind: 'balances' | 'history' | 'rewards' | 'scores', reason: string) => fetchApiBlob('/api/mileage/exports', { method: 'POST', accountId, body: JSON.stringify({ accountId, kind, reason }) }),
    rewardFolders: (accountId: string) => fetchApi<ApiResponse<Array<{ id: string; name: string; displayOrder: number; count: number }>>>(`/api/mileage/reward-folders?accountId=${encodeURIComponent(accountId)}`),
    createRewardFolder: (accountId: string, name: string) => fetchApi<ApiResponse<{ id: string; name: string; displayOrder: number; count: number }>>('/api/mileage/reward-folders', { method: 'POST', body: JSON.stringify({ accountId, name }) }),
    reorderRewardFolders: (accountId: string, ids: string[]) => fetchApi<ApiResponse<Array<{ id: string; name: string; displayOrder: number; count: number }>>>('/api/mileage/reward-folders/order', { method: 'PUT', body: JSON.stringify({ accountId, ids }) }),
    moveRewardToFolder: (id: string, accountId: string, folderId: string | null) => fetchApi<ApiResponse<MileageRewardSummary>>(`/api/mileage/rewards/${encodeURIComponent(id)}/folder`, { method: 'PUT', body: JSON.stringify({ accountId, folderId }) }),
    /*
      使い道の一覧（#772 の口）。**アカウント単位で返る。**
      渡さないと、ほかの店の使い道まで混ざる。
    */
    /** 1件を読む（編集のとき）。 */
    reward: (id: string, accountId: string) =>
      fetchApi<ApiResponse<MileageRewardSummary>>(
        `/api/mileage/rewards/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`,
      ),
    /** 新しく作る。**下書きとして作られる。** その場では公開しない。 */
    createReward: (accountId: string, draft: MileageRewardDraftInput) =>
      fetchApi<ApiResponse<MileageRewardSummary>>('/api/mileage/rewards', {
        method: 'POST',
        body: JSON.stringify({ accountId, draft }),
      }),
    /** 公開中の使い道から、編集用の下書き版を作る。 */
    createRewardDraft: (id: string, accountId: string) =>
      fetchApi<ApiResponse<MileageRewardSummary>>(`/api/mileage/rewards/${encodeURIComponent(id)}/draft`, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    /** 下書きを書き換える。読み込んだ版IDと更新番号で同時編集を検知する。 */
    saveRewardDraft: (
      id: string,
      accountId: string,
      expectedVersionId: string,
      expectedRevision: number,
      draft: MileageRewardDraftInput,
    ) =>
      fetchApi<ApiResponse<MileageRewardSummary>>(`/api/mileage/rewards/${encodeURIComponent(id)}/draft`, {
        method: 'PATCH',
        body: JSON.stringify({ accountId, expectedVersionId, expectedRevision, draft }),
      }),
    /** 下書きを公開する。**ここで初めてお客様に見える。**確認した版と更新番号を添えて、途中の保存とすれ違わない。 */
    publishReward: (id: string, accountId: string, expectedVersionId?: string, expectedRevision?: number) =>
      fetchApi<ApiResponse<MileageRewardSummary>>(`/api/mileage/rewards/${encodeURIComponent(id)}/publish`, {
        method: 'POST',
        headers: { 'X-Confirm-Irreversible': 'mileage-reward-publish' },
        body: JSON.stringify({ accountId, expectedVersionId, expectedRevision }),
      }),
    /** 下書きで受け渡せるかだけ確かめる。残高・在庫は動かさない。 */
    testReward: (id: string, accountId: string) =>
      fetchApi<ApiResponse<MileageRewardTestResult>>(`/api/mileage/rewards/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    /** 出すのをやめる。**消さない**——交換の記録が残るため。 */
    stopReward: (id: string, accountId: string) =>
      fetchApi<ApiResponse<MileageRewardSummary>>(`/api/mileage/rewards/${encodeURIComponent(id)}/stop`, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    /*
      止めた使い道を、止める前と同じ公開版でもう一度出す（N-236）。
      下書きの公開ではなく公開済み版の再掲なので、確認ヘッダは要らない。
    */
    resumeReward: (id: string, accountId: string) =>
      fetchApi<ApiResponse<MileageRewardSummary>>(`/api/mileage/rewards/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ accountId, status: 'published' }),
      }),
    rewards: (accountId: string) =>
      fetchApi<ApiResponse<MileageRewardAdminOverview>>(
        `/api/mileage/rewards?accountId=${encodeURIComponent(accountId)}`,
      ),
    overview: (params?: { accountId?: string; search?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.accountId) query.set('accountId', params.accountId)
      if (params?.search) query.set('search', params.search)
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.offset !== undefined) query.set('offset', String(params.offset))
      const suffix = query.toString() ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<MileageAdminOverview>>(`/api/mileage/overview${suffix}`)
    },
    friendsV6: (params: { accountId: string; search?: string; friendId?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ accountId: params.accountId })
      if (params.search) query.set('search', params.search)
      if (params.friendId) query.set('friendId', params.friendId)
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
      return fetchApi<ApiResponse<MileageFriendsV6Overview>>(`/api/mileage/friends?${query.toString()}`)
    },
    earningRulesV6: (params: { accountId: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ accountId: params.accountId })
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
      return fetchApi<ApiResponse<MileageEarningRulesV6Overview>>(
        `/api/mileage/earning-rules?${query.toString()}`,
      )
    },
    saveEarningRuleDraft: (id: string, data: {
      accountId: string
      expectedVersion: number | null
      draft: MileageEarningRuleDraftV6
    }) => fetchApi<ApiResponse<{
      ruleId: string
      lineAccountId: string
      version: number
      draft: MileageEarningRuleDraftV6
      updatedAt: string
    }>>(`/api/mileage/earning-rules/${encodeURIComponent(id)}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    /**
     * N-243: 並び順はアカウントの全件を1回で保存する一括口。
     * 1件ずつPATCHすると途中失敗で部分適用になるため使い分ける。
     */
    saveEarningRulesOrder: (data: { accountId: string; ids: string[] }) =>
      fetchApi<ApiResponse<null>>('/api/mileage/earning-rules-order', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    /**
     * N-231 案1: 下書きを公開版として固定し実行へ反映する。
     * 取り消せない操作のため確認ヘッダーと冪等キーが必須。
     */
    publishEarningRule: (id: string, data: {
      accountId: string
      expectedVersion: number
      idempotencyKey: string
    }) => fetchApi<ApiResponse<{
      ruleId: string
      versionId: string
      versionNumber: number
      publishedAt: string
    }>>(`/api/mileage/earning-rules/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      headers: {
        'X-Confirm-Irreversible': 'mileage-earning-rule-publish',
        'Idempotency-Key': data.idempotencyKey,
      },
      body: JSON.stringify({ accountId: data.accountId, expectedVersion: data.expectedVersion }),
    }),
    history: (params: {
      accountId: string
      search?: string
      /** V6R-CX-e: この友だちと同じ人の履歴だけ。 */
      friendId?: string
      kind?: MileageHistoryKind
      entryTypes?: MileageHistoryTypeFilter['entryTypes']
      entryType?: MileageHistoryItem['entryType']
      status?: MileageHistoryItem['status']
      mode?: 'automatic' | 'manual'
      from?: string
      to?: string
      limit?: number
      offset?: number
    }) => {
      const query = new URLSearchParams({ accountId: params.accountId })
      if (params.search) query.set('search', params.search)
      if (params.friendId) query.set('friendId', params.friendId)
      if (params.kind) query.set('kind', params.kind)
      if (params.entryTypes?.length) query.set('entryTypes', params.entryTypes.join(','))
      if (params.entryType) query.set('entryType', params.entryType)
      if (params.status) query.set('status', params.status)
      if (params.mode) query.set('mode', params.mode)
      if (params.from) query.set('from', params.from)
      if (params.to) query.set('to', params.to)
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
      return fetchApi<ApiResponse<MileageAdminHistory>>(`/api/mileage/history?${query.toString()}`)
    },
    adjustmentPolicy: (accountId: string) =>
      fetchApi<ApiResponse<MileageAdjustmentPolicy>>(
        `/api/mileage/adjustment-policy?accountId=${encodeURIComponent(accountId)}`,
      ),
    setAdjustmentPolicy: (data: { accountId: string; approvalThreshold: number }) =>
      fetchApi<ApiResponse<MileageAdjustmentPolicy>>('/api/mileage/adjustment-policy', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    adjust: (data: {
      accountId: string
      friendId: string
      direction: 'increase' | 'decrease'
      amount: number
      reasonCategory: 'customer_support' | 'order_correction' | 'grant_correction' | 'campaign' | 'other'
      reason: string
      sourceReferenceId?: string
      expiresAt?: string
      notifyFriend?: boolean
    }, idempotencyKey: string) => fetchApi<ApiResponse<MileageAdjustmentResult | MileageAdjustmentApprovalResult>>('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify(data),
    }),
    adjustmentApprovals: (accountId: string, status?: 'pending' | 'approved' | 'rejected' | 'cancelled') =>
      fetchApi<ApiResponse<MileageAdjustmentApprovalRequest[]>>(
        `/api/mileage/adjustment-approvals?accountId=${encodeURIComponent(accountId)}${status ? `&status=${status}` : ''}`,
      ),
    approveAdjustment: (requestId: string, accountId: string) =>
      fetchApi<ApiResponse<{ request: MileageAdjustmentApprovalRequest; entryId: string }>>(
        `/api/mileage/adjustment-approvals/${encodeURIComponent(requestId)}/approve`,
        { method: 'POST', body: JSON.stringify({ accountId }) },
      ),
    rejectAdjustment: (requestId: string, accountId: string, reason?: string) =>
      fetchApi<ApiResponse<{ request: MileageAdjustmentApprovalRequest }>>(
        `/api/mileage/adjustment-approvals/${encodeURIComponent(requestId)}/reject`,
        { method: 'POST', body: JSON.stringify({ accountId, reason }) },
      ),
    cancelAdjustment: (requestId: string, accountId: string) =>
      fetchApi<ApiResponse<{ request: MileageAdjustmentApprovalRequest }>>(
        `/api/mileage/adjustment-approvals/${encodeURIComponent(requestId)}/cancel`,
        { method: 'POST', body: JSON.stringify({ accountId }) },
      ),
    confirmMileageEntry: (entryId: string, data: { accountId: string; reason: string }) =>
      fetchApi<ApiResponse<{ entry: unknown; alreadyConfirmed: boolean }>>(
        `/api/mileage/entries/${encodeURIComponent(entryId)}/confirm`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    voidMileageEntry: (entryId: string, data: { accountId: string; reason: string }) =>
      fetchApi<ApiResponse<{ entry: unknown; reversalEntryId: string }>>(
        `/api/mileage/entries/${encodeURIComponent(entryId)}/void`,
        {
          method: 'POST',
          headers: { 'X-Confirm-Irreversible': 'mileage-entry-void' },
          body: JSON.stringify(data),
        },
      ),
    /*
     * R380/R381: 残高は動かさず、調整につけた友だち通知だけを再送する。
     * 送り済みなら何もしない（サーバ側で二度送らない）。
     */
    retryMileageNotification: (entryId: string, data: { accountId: string }) =>
      fetchApi<ApiResponse<{ notification: MileageAdjustmentResult['notification'] }>>(
        `/api/mileage/entries/${encodeURIComponent(entryId)}/notification-retry`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    testEarningRule: (accountId: string, draft: unknown) =>
      fetchApi<ApiResponse<MileageEarningRuleTestResult>>('/api/mileage/earning-rules/test', {
        method: 'POST',
        body: JSON.stringify({ accountId, draft }),
      }),
    rules: () => fetchApi<ApiResponse<MileageRule[]>>('/api/mileage/rules'),
    createRule: (data: {
      name: string
      eventType: string
      source?: string | null
      amount: number
      initialStatus?: 'pending' | 'available'
      conditions?: MileageRule['conditions'] | null
      validFrom?: string | null
      validUntil?: string | null
      /** #532(#521): 帰属するLINEアカウント。口で必須。 */
      lineAccountId: string
      /** DRAFT-01: falseなら最初から停止中で作る。省略は従来どおり稼働。 */
      isActive?: boolean
    }, options?: { idempotencyKey?: string }) =>
      fetchApi<ApiResponse<MileageRule>>('/api/mileage/rules', {
      method: 'POST',
      headers: options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
      body: JSON.stringify(data),
    }),
    updateRule: (id: string, data: Partial<Pick<MileageRule,
      'name' | 'eventType' | 'source' | 'amount' | 'initialStatus' | 'conditions' | 'isActive'
      | 'validFrom' | 'validUntil'
    >>) => fetchApi<ApiResponse<MileageRule>>(`/api/mileage/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    deleteRule: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/mileage/rules/${id}`, { method: 'DELETE' }),
  },
}
