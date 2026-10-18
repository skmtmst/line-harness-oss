import { fetchApi } from '../transport/request'
import type { ApiResponse, Affiliate } from '@line-crm/shared'
import type {
  AffiliateArchiveImpact,
  AffiliatePaymentSummary,
  AffiliateSettlementPreview,
  AffiliateAccountSettlementPreview,
  AffiliateSettlementResume,
  AffiliateAccountSettlementResult,
  AffiliatePayoutBatch,
  AffiliateStatement,
  AffiliateOffer,
  OfferVersion,
  OfferCapStatus,
} from '../types/affiliates'

export const affiliatesMethods = {
  affiliates: {
    list: (accountId?: string) =>
      fetchApi<ApiResponse<Affiliate[]>>('/api/affiliates' + (accountId ? `?accountId=${encodeURIComponent(accountId)}` : '')),
    get: (id: string) =>
      fetchApi<ApiResponse<Affiliate>>(`/api/affiliates/${id}`),
    // Admin-side create. Codes are auto-generated (random) — no manual `code`
    // needed. Pass `friendId` to bind 1:1 to a LINE friend; the response then
    // includes an issued `link` (refCode + url) unless issueInitialLink=false.
    // The legacy explicit `code` form still works for OSS back-compat.
    create: (data: {
      folderId?: string | null
      name?: string
      code?: string
      rewardMode?: 'none' | 'fixed' | 'rate'
      commissionRate?: number
      friendId?: string
      issueInitialLink?: boolean
      lineAccountId?: string
      /** 安定した操作UUID（#686）。同じ値での再送は同じ登録を返す。 */
      operationId?: string
      /** R525: オフで登録したら最初の行から停止で作る。省略時は稼働。 */
      isActive?: boolean
    }) =>
      fetchApi<ApiResponse<Affiliate> & { link?: { refCode: string; url: string } | null }>(
        '/api/affiliates',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
      ),
    update: (
      id: string,
      data: Partial<
        Pick<
          Affiliate,
          | 'folderId'
          | 'name'
          | 'rewardMode'
          | 'commissionRate'
          | 'isActive'
          | 'email'
          | 'holdDays'
          | 'payoutCycle'
          | 'notifyOnConversion'
        >
      >,
    ) =>
      fetchApi<ApiResponse<Affiliate>>(`/api/affiliates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    archiveImpact: (id: string) =>
      fetchApi<ApiResponse<AffiliateArchiveImpact>>(`/api/affiliates/${id}/archive-impact`),
    archive: (id: string, data: { mode: 'pause' | 'archive'; confirmationName?: string }) =>
      fetchApi<ApiResponse<{
        affiliateId: string
        lifecycle: 'paused' | 'archived'
        recordsPreserved: true
      }>>(`/api/affiliates/${id}/archive`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** v2 report: clicks, friendAdds, conversionsByPoint, estimatedCommission, duplicateFlags */
    reportV2: (id: string, params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<{
        affiliateId: string;
        affiliateName: string;
        code: string;
        commissionRate: number;
        clicks: number;
        linkClicks: number;
        friendAdds: number;
        conversions: number;
        conversionsByPoint: Array<{ conversionPointId: string; name: string; count: number; value: number }>;
        revenue: number;
        estimatedCommission: number;
        duplicateFlags: Array<{ friendId: string; identityKey: string }>;
      }>>(`/api/affiliates/${id}/report?` + new URLSearchParams(params as Record<string, string>)),
    /** Cursor-paginated attributed-friend journey summaries */
    journeys: (id: string, params?: { limit?: number; beforeAt?: string; beforeId?: string }) => {
      const query = new URLSearchParams();
      if (params?.limit !== undefined) query.set('limit', String(params.limit));
      if (params?.beforeAt) query.set('beforeAt', params.beforeAt);
      if (params?.beforeId) query.set('beforeId', params.beforeId);
      const qs = query.toString();
      return fetchApi<{
        success: boolean;
        data: Array<{
          friendId: string;
          displayName: string | null;
          addedAt: string;
          refCode: string | null;
          touchCount: number;
          formCount: number;
          conversionCount: number;
          lastEventAt: string;
        }>;
        nextCursor: { beforeAt: string; beforeId: string } | null;
      }>(`/api/affiliates/${id}/journeys${qs ? `?${qs}` : ''}`);
    },
    /** List ref_code links for an affiliate (loaded on detail expand) */
    links: (id: string) =>
      fetchApi<ApiResponse<Array<{
        id: string;
        affiliate_id: string;
        ref_code: string;
        label: string | null;
        line_account_id: string | null;
        is_active: number;
        created_at: string;
        click_count: number;
        offer_id: string | null;
        offer_name: string | null;
      }>>>(`/api/affiliates/${id}/links`),
    /** All-affiliates aggregate report (single-pass, no N+1) */
    allReport: (params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<Array<{
        affiliateId: string;
        affiliateName: string;
        code: string;
        commissionRate: number;
        totalClicks: number;
        totalConversions: number;
        totalRevenue: number;
        confirmedReward: number;
        linkCount: number;
        friendAdds: number;
      }>>>('/api/affiliates-report?' + new URLSearchParams(params as Record<string, string>)),
    paymentSummaries: (lineAccountId: string) =>
      fetchApi<{
        success: boolean
        data: AffiliatePaymentSummary[]
        limitations: {
          payoutHistory: false
          settlementHistory: true
          bankDestination: false
          settlementSchedule: false
        }
        error?: string
      }>(`/api/affiliate-payments?${new URLSearchParams({ lineAccountId })}`),
    paymentPreview: (id: string, lineAccountId: string) =>
      fetchApi<ApiResponse<AffiliateSettlementPreview>>(
        `/api/affiliate-payments/${id}/preview?${new URLSearchParams({ lineAccountId })}`,
      ),
    confirmPayment: (
      id: string,
      data: { lineAccountId: string; expectedAmount: number; idempotencyKey: string },
    ) => fetchApi<ApiResponse<{
      kind: 'created' | 'duplicate'
      settlementId: string
      amount: number
      conversionCount: number
      closedAt: string
    }>>(`/api/affiliate-payments/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    settlementPreview: (
      lineAccountId: string,
      period: { periodFrom: string; periodTo: string },
    ) => fetchApi<ApiResponse<AffiliateAccountSettlementPreview>>(
      `/api/affiliate-settlements/preview?${new URLSearchParams({ lineAccountId, ...period })}`,
    ),
    /** R43: この期間に締め済みの台帳があれば、明細発行・CSV準備を再開するための情報を返す。 */
    settlementCurrent: (
      lineAccountId: string,
      period: { periodFrom: string; periodTo: string },
    ) => fetchApi<ApiResponse<AffiliateSettlementResume | null>>(
      `/api/affiliate-settlements/current?${new URLSearchParams({ lineAccountId, ...period })}`,
    ),
    closeSettlement: (
      data: {
        lineAccountId: string
        periodFrom: string
        periodTo: string
        expectedPreviewVersion: string
      },
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<AffiliateAccountSettlementResult>>('/api/affiliate-settlements', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    }),
    createPayoutBatch: (
      data: { lineAccountId: string; settlementId: string; expectedVersion: number; bankFormat: 'zengin_csv' },
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<AffiliatePayoutBatch>>('/api/affiliate-payout-batches', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    }),
    /* 直前再確認（V-1）。2段階認証がある人は 'totp'、無い人は 'password'。 */
    payoutStepUp: (input: { method: 'totp' | 'password'; value: string }) =>
      fetchApi<ApiResponse<{ token: string; purpose: 'affiliate.payout.export'; expiresAt: string }>>(
        '/api/auth/step-up',
        { method: 'POST', body: JSON.stringify(
          input.method === 'totp'
            ? { code: input.value, purpose: 'affiliate.payout.export' }
            : { password: input.value, purpose: 'affiliate.payout.export' },
        ) },
      ),
    exportPayoutBatch: (
      batchId: string,
      data: { lineAccountId: string; expectedVersion: number },
      stepUpToken: string,
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<AffiliatePayoutBatch & { downloadUrl: string }>>(
      `/api/affiliate-payout-batches/${encodeURIComponent(batchId)}/export`,
      {
        method: 'POST',
        headers: {
          'X-Step-Up-Token': stepUpToken,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(data),
      },
    ),
    createStatement: (
      data: { lineAccountId: string; settlementId: string; affiliateId: string; expectedVersion: number },
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<AffiliateStatement> & { notificationAttempted?: boolean }>(
      '/api/affiliate-statements',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(data),
      },
    ),
  },
  affiliateOffers: {
    list: (params?: { activeOnly?: boolean }) => {
      const qs = params?.activeOnly ? '?activeOnly=true' : ''
      return fetchApi<{ success: boolean; data: AffiliateOffer[] }>(`/api/affiliate-offers${qs}`)
    },
    get: (id: string) =>
      fetchApi<{ success: boolean; data: AffiliateOffer }>(`/api/affiliate-offers/${id}`),
    create: (data: {
      folderId?: string | null
      name: string
      description?: string | null
      rewardAmount?: number
      rewardMiles?: number
      windowDays?: number
      capTotal?: number | null
      capMonthlyPerAffiliate?: number | null
      receptionFrom?: string | null
      receptionTo?: string | null
      lineAccountId?: string | null
      tagId?: string | null
      scenarioId?: string | null
      /** DRAFT-01: falseなら最初から非公開で作る。省略は従来どおり公開。 */
      isActive?: boolean
      /** 安定した操作UUID（#686）。同じ値での再送は同じ登録を返す。 */
      operationId?: string
    }) =>
      fetchApi<{ success: boolean; data: AffiliateOffer }>('/api/affiliate-offers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<{
      folderId: string | null
      name: string
      description: string | null
      rewardAmount: number
      rewardMiles: number
      windowDays: number
      capTotal: number | null
      capMonthlyPerAffiliate: number | null
      receptionFrom: string | null
      receptionTo: string | null
      lineAccountId: string | null
      tagId: string | null
      scenarioId: string | null
      isActive: boolean
    }>) =>
      fetchApi<{ success: boolean; data: AffiliateOffer }>(`/api/affiliate-offers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    /** 決まりの版の履歴（新しい順）。#823 */
    versions: (id: string) =>
      fetchApi<{ success: boolean; data: OfferVersion[] }>(
        `/api/affiliate-offers/${encodeURIComponent(id)}/versions`,
      ),
    /** 今の決まりと上限の残り。#823 */
    capStatus: (id: string, affiliateId?: string) => {
      const qs = affiliateId ? `?affiliateId=${encodeURIComponent(affiliateId)}` : ''
      return fetchApi<{ success: boolean; data: OfferCapStatus }>(
        `/api/affiliate-offers/${encodeURIComponent(id)}/cap-status${qs}`,
      )
    },
    /** 決まりの新しい版を保存する。前の版は変わらない。#823 */
    createVersion: (id: string, data: {
      rewardAmount?: number
      rewardMiles?: number
      windowDays?: number
      capTotal?: number | null
      capMonthlyPerAffiliate?: number | null
      receptionFrom?: string | null
      receptionTo?: string | null
      effectiveFrom?: string | null
      idempotencyKey?: string
    }) =>
      fetchApi<{ success: boolean; data: OfferVersion }>(
        `/api/affiliate-offers/${encodeURIComponent(id)}/versions`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
  },
}
