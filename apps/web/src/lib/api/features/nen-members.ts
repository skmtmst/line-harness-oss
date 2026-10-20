import { fetchApi } from '../transport/request'
import type { ApiResponse } from '@line-crm/shared'
import type {
  PhotoReviewMetrics,
  NenPhotoDetail,
  NenPhotoRewardActionResult,
  PhotoAssetStatus,
  PhotoDerivatives,
  PhotoBulkDecision,
  PhotoBulkReviewResult,
  NenPhotoPublicationList,
  PhotoRewardPolicyVersion,
} from '../types/nen-photos'
import type { PhotoAssetRun } from '../types/publication-types'
import { fetchApiBlob } from '../transport/download'
import type { NenFriendOverview } from '../types/nen-campaigns'

export const nenMembersMethods = {
  nenMembers: {
    overview: () => fetchApi<ApiResponse<{ pets: number; healthLogs: number; activeCare: number; pendingPhotos: number; members: number; consultations: number }>>('/api/nen-members/overview'),
    careFlags: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/care-flags'),
    /** M509: expectedUpdatedAt を渡すと、古い画面からの保存は最新の状態つきで409になる。省略時は従来どおり通す。 */
    updateCareFlag: (id: string, data: { status: 'active' | 'resolved'; adviceReady: boolean; expectedUpdatedAt?: string }) => fetchApi<{ success: boolean }>(`/api/nen-members/care-flags/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    photos: (accountId: string) => fetchApi<ApiResponse<Array<Record<string, unknown>>>>(`/api/nen-members/photos?accountId=${encodeURIComponent(accountId)}`),
    photoReviewMetrics: (accountId: string) => fetchApi<ApiResponse<PhotoReviewMetrics>>(
      `/api/nen-members/photos/review-metrics?accountId=${encodeURIComponent(accountId)}`,
    ),
    photo: (id: string, accountId: string) => fetchApi<ApiResponse<NenPhotoDetail>>(
      `/api/nen-members/photos/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`,
    ),
    // PHOTO-06: 止まったポイント手続きの再試行と、EC側との照合。
    photoPointRetry: (id: string, accountId: string) => fetchApi<ApiResponse<NenPhotoRewardActionResult>>(
      `/api/nen-members/photos/${encodeURIComponent(id)}/point-retry`,
      { method: 'POST', body: JSON.stringify({ accountId }) },
    ),
    photoPointReconcile: (id: string, accountId: string) => fetchApi<ApiResponse<NenPhotoRewardActionResult>>(
      `/api/nen-members/photos/${encodeURIComponent(id)}/point-reconcile`,
      { method: 'POST', body: JSON.stringify({ accountId }) },
    ),
    photoAssetStatus: (id: string, accountId: string) => fetchApi<ApiResponse<PhotoAssetStatus>>(
      `/api/nen-members/photos/${encodeURIComponent(id)}/assets/status?accountId=${encodeURIComponent(accountId)}`,
    ),
    photoDerivatives: (id: string, accountId: string) => fetchApi<ApiResponse<PhotoDerivatives>>(
      `/api/nen-members/photos/${encodeURIComponent(id)}/assets/derivatives?accountId=${encodeURIComponent(accountId)}`,
    ),
    processPhotoAssets: (
      id: string,
      data: { lineAccountId: string; expectedVersion: number; operation: 'review' | 'public' | 'thumbnail' | 'all' },
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<PhotoAssetRun>>(
      `/api/nen-members/photos/${encodeURIComponent(id)}/assets/process`,
      { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) },
    ),
    bulkReviewPhotos: (
      data: { lineAccountId: string; decisions: PhotoBulkDecision[] },
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<PhotoBulkReviewResult>>(
      '/api/nen-members/photos/decisions/bulk',
      { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) },
    ),
    /* 直前再確認（V-1）。2段階認証がある人は 'totp'、無い人は 'password'。 */
    photoOriginalStepUp: (input: { method: 'totp' | 'password'; value: string }) => fetchApi<ApiResponse<{
      token: string
      purpose: 'photo.original.download'
      expiresAt: string
    }>>('/api/auth/step-up', {
      method: 'POST', body: JSON.stringify(
        input.method === 'totp'
          ? { code: input.value, purpose: 'photo.original.download' }
          : { password: input.value, purpose: 'photo.original.download' },
      ),
    }),
    issuePhotoOriginalDownload: (
      id: string,
      data: { lineAccountId: string; expectedVersion: number },
      stepUpToken: string,
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<{ downloadUrl: string; expiresAt: string; oneTime: true }>>(
      `/api/nen-members/photos/${encodeURIComponent(id)}/original-download`,
      {
        method: 'POST',
        headers: { 'X-Step-Up-Token': stepUpToken, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(data),
      },
    ),
    downloadPhotoOriginal: (downloadUrl: string) => fetchApiBlob(downloadUrl),
    photoPublications: (accountId: string) => fetchApi<ApiResponse<NenPhotoPublicationList>>(
      `/api/nen-members/photos/publications?accountId=${encodeURIComponent(accountId)}`,
    ),
    photoPublicationOrder: (accountId: string) =>
      fetchApi<ApiResponse<{ items: Array<{id: string; version: number; pet_name: string}> }>>(
        `/api/nen-members/photos/publications/order?accountId=${encodeURIComponent(accountId)}`,
      ),
    savePhotoPublicationOrder: (data: import('@line-crm/shared').PhotoPublicationOrderInput) =>
      fetchApi<ApiResponse<{ items: Array<{id: string; version: number; sortOrder: number}> }>>(
        '/api/nen-members/photos/publications/order', { method: 'PUT', body: JSON.stringify(data) },
      ),
    publishPhoto: (id: string, data: { accountId: string; expectedVersion: number }, idempotencyKey: string) =>
      fetchApi<ApiResponse<import('@line-crm/shared').PhotoPublicationPublishResult>>(
        `/api/nen-members/photos/${encodeURIComponent(id)}/publish`,
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) },
      ),
    withdrawPhotoPublication: (id: string, data: { accountId: string; expectedVersion: number }, idempotencyKey: string) =>
      fetchApi<ApiResponse<{ status: 'withdrawn'; version: number }>>(
        `/api/nen-members/photos/publications/${encodeURIComponent(id)}/withdraw`,
        { method: 'PUT', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) },
      ),
    updatePhotoPublicationPlacements: (id: string, data: {
      accountId: string
      expectedVersion: number
      placements: Array<{ type: 'rich_menu' | 'column' | 'form' | 'site'; label: string }>
    }, idempotencyKey: string) => fetchApi<ApiResponse<{ version: number; placementCount: number }>>(
      `/api/nen-members/photos/publications/${encodeURIComponent(id)}/placements`,
      { method: 'PUT', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) },
    ),
    reviewPhoto: (id: string, data: {
      accountId: string
      status: 'adopted' | 'rejected'
      expectedVersion: number
      reasonCode?: 'quality' | 'privacy' | 'unrelated' | 'duplicate' | 'other'
      reasonNote?: string
      // 差戻し画面の2つの約束（#931 N-312）。省略時は従来どおり案内あり・印なし。
      resubmitInvite?: boolean
      watchSubmitter?: boolean
      // #817: 重複のときの「報酬なしで採用」。点数を付けずに採用だけ残す。
      withoutReward?: boolean
    }, idempotencyKey: string) => fetchApi<ApiResponse<{
      awardedPoints: number
      pointBalance: number | null
      pointSync: string
      notificationStatus: 'sent' | 'failed'
      // #817: 点数を付けなかった理由。重複の二重報酬止め・選んだ報酬なし。
      rewardSkipped?: 'duplicate' | 'requested' | null
    }>>(`/api/nen-members/photos/${encodeURIComponent(id)}/review`, {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    }),
    /**
     * #817: 報酬の決まりの版。保存するたびに版を1つ足し、前の版は変えない。
     * 確認キーは自動で振る。
     */
    photoRewardPolicyVersions: () => fetchApi<ApiResponse<PhotoRewardPolicyVersion[]>>(
      '/api/nen-members/photo-reward-policy/versions',
    ),
    createPhotoRewardPolicyVersion: (data: {
      publicationPoints?: number
      points: number
      summary?: string
      effectiveFrom?: string | null
      expectedVersion?: number
    }) => fetchApi<ApiResponse<{
      created: boolean
      version: Omit<PhotoRewardPolicyVersion, 'status' | 'createdBy'>
    }>>(
      '/api/nen-members/photo-reward-policy/versions',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(data),
      },
    ),
    revertPhotoRewardPolicyVersion: (data: { versionNumber: number }) => fetchApi<ApiResponse<{
      created: boolean
      version: Omit<PhotoRewardPolicyVersion, 'status' | 'createdBy'>
    }>>(
      '/api/nen-members/photo-reward-policy/revert',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(data),
      },
    ),
    retryPhotoReviewNotification: (id: string, accountId: string, idempotencyKey: string) => fetchApi<ApiResponse<{
      notificationStatus: 'sent' | 'failed'
      resent?: boolean
    }>>(`/api/nen-members/photos/${encodeURIComponent(id)}/notification/retry`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ accountId }),
    }),
    // 詳細画面で直した写真の向きを版つきで保存する（#931 N-309）。
    savePhotoRotation: (id: string, data: {
      accountId: string
      rotation: 0 | 90 | 180 | 270
      expectedVersion: number
    }, idempotencyKey: string) => fetchApi<ApiResponse<{
      rotation: number
      reviewVersion: number
    }>>(`/api/nen-members/photos/${encodeURIComponent(id)}/rotation`, {
      method: 'PUT',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    }),
    friendOverview: (friendId: string) => fetchApi<ApiResponse<NenFriendOverview>>(`/api/nen-members/friends/${encodeURIComponent(friendId)}`),
    ranks: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/ranks'),
    installRichMenu: (accountId: string) => fetchApi<ApiResponse<{ richMenuId: string; liffId: string }>>('/api/nen-members/rich-menu/install', { method: 'POST', body: JSON.stringify({ accountId }) }),
  },
}
