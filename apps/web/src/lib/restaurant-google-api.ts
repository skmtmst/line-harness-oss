import { fetchApi } from './api'

/** 飲食店向け「Googleビジネス」のAPI。第1段（設定＋口コミ）★V6 GB-1〜GB-3、GB-13、GB-15、GB-16。第2段（プロフィール・営業時間・変更履歴）GB-10〜GB-12、GB-17〜GB-19。 */

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

// ---------- 第2段：プロフィール・営業時間・変更履歴 ----------

export type GoogleWeekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'
export type GoogleHoursPeriod = { open: string; close: string }
export type GoogleWeeklyHours = Record<GoogleWeekday, GoogleHoursPeriod[]>
export type GoogleSpecialDay = { date: string; closed: boolean; periods: GoogleHoursPeriod[] }
export type GoogleProfileAddress = { postalCode: string | null; administrativeArea: string | null; locality: string | null; addressLines: string[] }

export type GoogleProfile = {
  name: string
  title: string | null
  address: GoogleProfileAddress | null
  phone: string | null
  websiteUri: string | null
  description: string | null
  openStatus: string | null
  regularHours: GoogleWeeklyHours
  specialHours: GoogleSpecialDay[]
  mapsUri: string | null
}

export type GoogleHoliday = { date: string; name: string; weekday: GoogleWeekday; special: GoogleSpecialDay | null; regular?: GoogleHoursPeriod[] }

export type GoogleProfileData = {
  success: true
  store: { id: string; name: string; lineAccountId: string }
  profile: GoogleProfile
  today: { date: string; weekday: GoogleWeekday; holidayName: string | null; periods: GoogleHoursPeriod[]; closed: boolean; special: boolean }
  holidays: GoogleHoliday[]
  timeZone: string
  closed: boolean
  photoCount: number | null
  googleUpdates: { fields: Array<{ mask: string; label: string }>; updated: Partial<GoogleProfile> } | null
  fetchedAt: string
  stale: boolean
  refreshError: string | null
  pendingChangeCount: number
  writeEnabled: boolean
  aiAvailable: boolean
  permissions: { canManageConnection: boolean; canPublishReply: boolean; canSendChange: boolean }
}

export type GoogleChangeKind = 'special_hours' | 'regular_hours' | 'profile' | 'photo'
export type GoogleChangeStatus = 'draft' | 'pending_confirm' | 'accepted' | 'applied' | 'failed' | 'conflict' | 'cancelled'
export type GoogleChangeTarget = { dates: string[] } | { weekdays: GoogleWeekday[] } | { field: 'title' | 'phone' | 'websiteUri' | 'description' | 'address' } | { field: 'photo'; action: 'add' | 'delete' }
export type GoogleDayHours = { date: string; closed: boolean; periods: GoogleHoursPeriod[] }

export type GoogleChange = {
  id: string
  kind: GoogleChangeKind
  source: 'shortcut' | 'text' | 'calendar' | 'weekly' | 'profile_edit' | 'photo'
  summary: string
  target: GoogleChangeTarget
  before: unknown
  after: unknown
  inputText: string | null
  reservationImpactCount: number
  status: GoogleChangeStatus
  staffName: string | null
  error: string | null
  createdAt: string
  sentAt: string | null
  appliedAt: string | null
  updatedAt: string
}

export type GoogleHoursProposal =
  | { source: 'shortcut'; shortcut: 'close_today' }
  | { source: 'shortcut'; shortcut: 'early_close_today'; closeTime: string }
  | { source: 'text'; text: string }
  | { source: 'calendar'; days: GoogleDayHours[] }
  | { source: 'weekly'; weekly: GoogleWeeklyHours }

export type GoogleProfileProposal =
  | { field: 'title' | 'phone' | 'websiteUri' | 'description'; value: string }
  | { field: 'address'; value: GoogleProfileAddress }
  | { field: 'photo'; action: 'add'; mediaId: string }
  | { field: 'photo'; action: 'delete'; mediaName: string }

export type GooglePhoto = { name: string; googleUrl: string | null; thumbnailUrl: string | null; category: string | null; createTime: string | null }

export type GoogleHistoryEntry = {
  id: string
  kind: GoogleChangeKind | 'review_reply'
  summary: string
  staffName: string | null
  status: GoogleChangeStatus
  error: string | null
  createdAt: string
  changeId: string | null
}
export type GoogleHistoryKind = 'all' | 'hours' | 'profile' | 'review_reply'
export type GoogleHistoryResult = 'all' | 'applied' | 'pending' | 'failed'
export type GoogleHistoryData = { success: true; changes: GoogleHistoryEntry[]; total: number; page: number; perPage: number; counts: Record<GoogleHistoryKind, number>; days: number }

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

  // 第2段
  profile: (accountId: string) => fetchApi<GoogleProfileData>(withAccount(`${base}/profile`, accountId)),
  syncProfile: (accountId: string) => fetchApi<GoogleProfileData>(withAccount(`${base}/profile/sync`, accountId), { method: 'POST', body: '{}' }),
  holidays: (accountId: string, days = 30) => fetchApi<{ success: true; today: string; days: number; holidays: GoogleHoliday[] }>(withAccount(`${base}/holidays`, accountId, { days })),
  photos: (accountId: string) => fetchApi<{ success: true; photos: GooglePhoto[] }>(withAccount(`${base}/photos`, accountId)),
  proposeHours: (accountId: string, proposal: GoogleHoursProposal) =>
    fetchApi<{ success: true; change?: GoogleChange; question?: string }>(withAccount(`${base}/hours/propose`, accountId), { method: 'POST', body: JSON.stringify(proposal) }),
  proposeProfile: (accountId: string, proposal: GoogleProfileProposal) =>
    fetchApi<{ success: true; change: GoogleChange }>(withAccount(`${base}/profile/propose`, accountId), { method: 'POST', body: JSON.stringify(proposal) }),
  change: (accountId: string, id: string) =>
    fetchApi<{ success: true; change: GoogleChange; store: { id: string; name: string; timeZone: string }; writeEnabled: boolean; canSend: boolean }>(withAccount(`${base}/changes/${encodeURIComponent(id)}`, accountId)),
  sendChange: (accountId: string, id: string) =>
    fetchApi<{ success: true; alreadyApplied: boolean; change: GoogleChange }>(withAccount(`${base}/changes/${encodeURIComponent(id)}/send`, accountId), { method: 'POST', body: JSON.stringify({ confirmed: true }) }),
  cancelChange: (accountId: string, id: string) =>
    fetchApi<{ success: true; change: GoogleChange }>(withAccount(`${base}/changes/${encodeURIComponent(id)}/cancel`, accountId), { method: 'POST', body: '{}' }),
  history: (accountId: string, params: { kind?: GoogleHistoryKind; result?: GoogleHistoryResult; days?: number; q?: string; page?: number; perPage?: number }) =>
    fetchApi<GoogleHistoryData>(withAccount(`${base}/changes`, accountId, { kind: params.kind, result: params.result, days: params.days, q: params.q, page: params.page, per_page: params.perPage })),
}
