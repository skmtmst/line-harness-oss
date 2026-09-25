import { fetchApi } from './api'

/** 飲食店向け「Googleビジネス」第1段（設定＋口コミ）のAPI。★V6 GB-1〜GB-3、GB-13、GB-15、GB-16。 */

export type GoogleConnectionStatus = 'pending_location' | 'connected' | 'expired' | 'no_permission' | 'disconnected'
export type GoogleReplyStatus = 'unreplied' | 'draft' | 'pending_confirm' | 'replied' | 'published'

export type GoogleConnection = {
  status: GoogleConnectionStatus
  googleAccountEmail?: string | null
  locationName?: string | null
  locationTitle?: string | null
  locationMapsUrl?: string | null
  connectedAt?: string | null
  disconnectedAt?: string | null
  lastSyncedAt?: string | null
  lastSyncError?: string | null
  averageRating?: number | null
  totalReviewCount?: number | null
}

export type GoogleLocationCandidate = { locationName: string; locationTitle: string; addressText: string | null }

export type GoogleConnectionData = {
  success: true
  store: { id: string; name: string; lineAccountId: string }
  connection: GoogleConnection
  candidates: GoogleLocationCandidate[]
  summary: { unrepliedCount: number; draftCount: number; attentionCount: number; newCount: number; storedCount: number; syncStale: boolean }
  writeEnabled: boolean
  oauthConfigured: boolean
  aiAvailable: boolean
  permissions: { canManageConnection: boolean; canPublishReply: boolean }
}

export type GoogleReview = {
  id: string
  reviewName: string
  reviewerDisplayName: string | null
  starRating: number
  comment: string | null
  createTime: string
  updateTime: string | null
  needsAttention: boolean
  replyStatus: GoogleReplyStatus
  replyDraft: string | null
  replyDraftAiGenerated: boolean
  replyDraftGeneratedAt: string | null
  replyComment: string | null
  replyUpdateTime: string | null
  firstSeenAt: string
  updatedAt: string
}

export type GoogleReviewFilter = 'unreplied' | 'draft' | 'attention' | 'all'
export type GoogleReviewOrder = 'newest' | 'oldest' | 'rating_low' | 'rating_high'

export type GoogleReviewListData = {
  success: true
  reviews: GoogleReview[]
  page: number
  perPage: number
  total: number
  connection: GoogleConnection
}

function withAccount(path: string, accountId: string, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams({ account_id: accountId })
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  return `${path}?${search.toString()}`
}

const base = '/api/restaurant-test/google'

export const restaurantGoogleApi = {
  connection: (accountId: string) => fetchApi<GoogleConnectionData>(withAccount(`${base}/connection`, accountId)),
  connectStart: (accountId: string) =>
    fetchApi<{ success: true; mode: 'connect' | 'reconnect'; authorizeUrl: string }>(withAccount(`${base}/connect/start`, accountId), { method: 'POST', body: '{}' }),
  selectLocation: (accountId: string, locationName: string) =>
    fetchApi<{ success: true; connection: GoogleConnection }>(withAccount(`${base}/connect/select-location`, accountId), { method: 'POST', body: JSON.stringify({ locationName }) }),
  disconnect: (accountId: string) =>
    fetchApi<{ success: true; revoked: boolean; connection: GoogleConnection }>(withAccount(`${base}/disconnect`, accountId), { method: 'POST', body: JSON.stringify({ confirmed: true }) }),
  syncReviews: (accountId: string) =>
    fetchApi<{ success: true; fetched: number; complete: boolean; averageRating: number | null; totalReviewCount: number | null; syncedAt: string }>(
      withAccount(`${base}/reviews/sync`, accountId),
      { method: 'POST', body: '{}' },
    ),
  listReviews: (accountId: string, params: { filter?: GoogleReviewFilter; rating?: number; order?: GoogleReviewOrder; q?: string; page?: number; perPage?: number }) =>
    fetchApi<GoogleReviewListData>(
      withAccount(`${base}/reviews`, accountId, { filter: params.filter, rating: params.rating, order: params.order, q: params.q, page: params.page, per_page: params.perPage }),
    ),
  review: (accountId: string, id: string) =>
    fetchApi<{ success: true; review: GoogleReview; store: { id: string; name: string }; connection: GoogleConnection }>(withAccount(`${base}/reviews/${encodeURIComponent(id)}`, accountId)),
  generateDraft: (accountId: string, id: string, mode: 'new' | 'shorter' | 'polite') =>
    fetchApi<{ success: true; draft: string; aiGenerated: true; generatedAt: string; mode: string }>(withAccount(`${base}/reviews/${encodeURIComponent(id)}/draft/generate`, accountId), {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  saveDraft: (accountId: string, id: string, replyDraft: string) =>
    fetchApi<{ success: true; review: GoogleReview }>(withAccount(`${base}/reviews/${encodeURIComponent(id)}/draft`, accountId), { method: 'PUT', body: JSON.stringify({ replyDraft }) }),
  publishReply: (accountId: string, id: string, comment: string) =>
    fetchApi<{ success: true; alreadyPublished: boolean; reply: { comment: string; updateTime: string | null }; review?: GoogleReview }>(
      withAccount(`${base}/reviews/${encodeURIComponent(id)}/reply`, accountId),
      { method: 'POST', body: JSON.stringify({ confirmed: true, comment }) },
    ),
}
