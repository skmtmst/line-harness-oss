import { fetchApi } from '../transport/request'
import type { ApiResponse, ScoringRule } from '@line-crm/shared'
import type {
  FriendScoreDetail,
  ActionScoreFilter,
  ActionScoreSort,
  ActionScoreOverview,
  ActionScoreRuleConfiguration,
  ActionScoreBands,
  ActionScoreRuleBundle,
  ActionScoreRuleTestResult,
  ActionScoreAdjustmentResult,
  ActionScoreBandPreview,
} from '../types/scores'

export const scoresMethods = {
  scoring: {
    rules: () =>
      fetchApi<ApiResponse<ScoringRule[]>>('/api/scoring-rules'),
    getRule: (id: string) =>
      fetchApi<ApiResponse<ScoringRule>>(`/api/scoring-rules/${id}`),
    createRule: (data: { name: string; eventType: string; scoreValue: number }) =>
      fetchApi<ApiResponse<ScoringRule>>('/api/scoring-rules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateRule: (id: string, data: Partial<Pick<ScoringRule, 'name' | 'eventType' | 'scoreValue' | 'isActive'>>) =>
      fetchApi<ApiResponse<ScoringRule>>(`/api/scoring-rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteRule: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scoring-rules/${id}`, { method: 'DELETE' }),
    friendScore: (friendId: string) =>
      fetchApi<ApiResponse<FriendScoreDetail>>(`/api/friends/${friendId}/score`),
  },
  actionScores: {
    friends: (params: {
      accountId: string
      search?: string
      filter?: ActionScoreFilter
      sort?: ActionScoreSort
      limit?: number
      offset?: number
    }) => {
      const query = new URLSearchParams({ accountId: params.accountId })
      if (params.search) query.set('search', params.search)
      if (params.filter) query.set('filter', params.filter)
      if (params.sort) query.set('sort', params.sort)
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
      return fetchApi<ApiResponse<ActionScoreOverview>>(`/api/action-scores/friends?${query.toString()}`)
    },
    rules: (accountId: string) =>
      fetchApi<ApiResponse<ActionScoreRuleConfiguration>>(
        `/api/action-scores/rules?accountId=${encodeURIComponent(accountId)}`,
      ),
    bands: (accountId: string) =>
      fetchApi<ApiResponse<ActionScoreBands>>(
        `/api/action-scores/bands?accountId=${encodeURIComponent(accountId)}`,
      ),
    /*
     * M505: 応答消失後の再送の要求キー。同じ内容のやり直しは同じキーで送り、
     * サーバは保存済みの結果を返す（`replayed`）。内容を変えたら別のキーにする。
     */
    saveDraft: (data: {
      accountId: string
      expectedDraftVersionId: string | null
      configuration: ActionScoreRuleBundle
    }, options?: { idempotencyKey?: string }) => fetchApi<ApiResponse<ActionScoreRuleConfiguration> & { replayed?: boolean }>('/api/action-scores/rules/draft', {
      method: 'PATCH',
      body: JSON.stringify(data),
      ...(options?.idempotencyKey ? { headers: { 'Idempotency-Key': options.idempotencyKey } } : {}),
    }),
    testRules: (data: {
      accountId: string
      configuration: ActionScoreRuleBundle
      currentScore: number
      eventType: string
      source?: string | null
      occurredAt?: string
    }) => fetchApi<ApiResponse<ActionScoreRuleTestResult>>('/api/action-scores/rules/test', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    publishRules: (data: { accountId: string; draftVersionId: string }) =>
      fetchApi<ApiResponse<ActionScoreRuleConfiguration>>('/api/action-scores/rules/publish', {
        method: 'POST',
        headers: { 'X-Confirm-Irreversible': 'action-score-rules-publish' },
        body: JSON.stringify(data),
      }),
    stopRules: (accountId: string) =>
      fetchApi<ApiResponse<ActionScoreRuleConfiguration>>('/api/action-scores/rules/stop', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    /*
      担当者が理由つきで1人分の点数を手で直す（N-235）。
      不可逆なので確認ヘッダを必須にし、同じ操作の再送は同じ冪等キーで潰す。
    */
    adjust: (
      data: {
        accountId: string
        friendId: string
        direction: 'increase' | 'decrease'
        amount: number
        reason: string
      },
      idempotencyKey: string,
    ) =>
      fetchApi<ApiResponse<ActionScoreAdjustmentResult>>('/api/action-scores/adjustments', {
        method: 'POST',
        headers: {
          'X-Confirm-Irreversible': 'action-score-adjustment',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(data),
      }),
    /*
      編集中の帯の分けかたで各帯の人数だけを数える読み取り専用プレビュー。
      公開版も友だちの点数も動かさない。
    */
    previewBands: (data: { accountId: string; bands: ActionScoreBands }) =>
      fetchApi<ApiResponse<ActionScoreBandPreview>>('/api/action-scores/bands/preview', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
}
