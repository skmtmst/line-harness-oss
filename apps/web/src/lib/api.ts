import { adminSessionHeaders } from './admin-session'
import type {
  Friend,
  FriendAddRouting,
  Tag,
  TagGroup,
  FriendField,
  FriendFieldType,
  SupportMark,
  Folder,
  SavedSearch,
  MediaItem,
  MediaUsage,
  CommonVar,
  CommonVarSchedule,
  Scenario,
  ScenarioStep,
  ApiResponse,
  PaginatedResponse,
  User,
  LineAccount,
  ConversionPoint,
  ConversionMeasureMethod,
  Affiliate,
  Template,
  Automation,
  AutomationLog,
  Chat,
  Reminder,
  ReminderStep,
  ReminderTriggerType,
  ScoringRule,
  IncomingWebhook,
  IncomingWebhookCreated,
  OutgoingWebhook,
  OutgoingWebhookCreated,
  NotificationRule,
  Notification,
  AccountHealthLog,
  AccountMigration,
  StaffMember,
  Broadcast,
  BroadcastTargetType,
  EntryRoute,
  EntryRouteGenre,
  CreateEntryRouteInput,
  EntryRouteFunnel,
  TrafficPool,
  PoolAccount,
} from '@line-crm/shared'

/** Affiliate offer (案件) as returned by the worker. */
export type AffiliateOffer = {
  id: string
  name: string
  description: string | null
  rewardAmount: number | null
  rewardMiles: number
  mileageProgramId: string
  lineAccountId: string | null
  tagId: string | null
  scenarioId: string | null
  isActive: boolean
  createdAt: string
}

/** Approval queue row as returned by /api/conversions/approvals */
export type ConversionApprovalItem = {
  eventId: string
  createdAt: string
  friendId: string
  friendName: string | null
  affiliateId: string
  affiliateName: string | null
  /** 案件ID。名前は同じものを作れるので、集計はこちらで結ぶ */
  offerId: string | null
  offerName: string | null
  /** 案件の付与マイル。案件に結びつかない成果は null */
  offerRewardMiles: number | null
  conversionPointName: string | null
  value: number | null
  approvalStatus: 'pending' | 'approved' | 'rejected'
  duplicateFlag: boolean
}

/** Broadcast type from API (now camelCase after worker serialization) */
export type ApiBroadcast = Omit<Broadcast, 'targetType'> & {
  targetType: BroadcastTargetType;
  accountIds: string[] | null;
  dedupPriority: string[] | null;
  failedAccountIds: string[] | null;
  trackLinks: boolean;
  messageBubbles?: BroadcastBubble[] | null;
};

export type BroadcastBubbleType = 'text' | 'sticker' | 'image' | 'flex' | 'rich_message' | 'rich_video' | 'video' | 'card_message' | 'coupon' | 'research';
export type BroadcastBubble = { id: string; type: BroadcastBubbleType; content: Record<string, unknown> };
export type BroadcastAssetKind = 'rich_message' | 'card_message' | 'coupon' | 'research';
export type BroadcastMessageAsset = {
  id: string;
  lineAccountId: string | null;
  kind: BroadcastAssetKind;
  name: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BroadcastInsight = {
  broadcastId?: string
  delivered: number | null
  uniqueImpression: number | null
  uniqueClick: number | null
  uniqueMediaPlayed: number | null
  openRate: number | null
  clickRate: number | null
  status?: string
  fetchedAt?: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set. Build cannot proceed without a valid API URL. ' +
    'Set it in .env.production (local) or GitHub Secrets (CI).'
  )
}

/**
 * Read the CSRF token issued at login. The session credential itself lives in
 * an HttpOnly cookie (never exposed to JS); only the CSRF token is held
 * client-side and echoed back via the X-CSRF-Token header on mutating
 * requests. In a cross-site topology the SPA cannot read the API's CSRF cookie
 * directly, so the token is delivered in the login/session response body and
 * cached here.
 */
// 一斉配信の本送信は取り消せない。サーバー側がこのヘッダを見て、
// 画面の確認手順を経ずに URL を直接叩く操作を弾く。
const IRREVERSIBLE_BROADCAST_HEADERS = { 'X-Confirm-Irreversible': 'broadcast-send' }

export const CSRF_STORAGE_KEY = 'lh_csrf'

export function getCsrfToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(CSRF_STORAGE_KEY) || ''
}

export function setCsrfToken(token: string | undefined | null): void {
  if (typeof window === 'undefined' || !token) return
  localStorage.setItem(CSRF_STORAGE_KEY, token)
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Non-2xx API responses. message prefers the reason the Worker sent, falling
 * back to the legacy `API error: <status>` shape (existing catch blocks render
 * e.message), while `status` lets callers branch on the code without parsing
 * the string.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message?: string) {
    super(message || `API error: ${status}`)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Statuses whose response body is safe to show the operator verbatim.
 *
 * 400 is the Worker rejecting input it validated itself — the message names
 * what to fix and contains nothing the operator should not see. Everything
 * else (upstream LINE API failures, unhandled exceptions, proxy pages) can
 * carry internal detail, so those keep the generic status message no matter
 * what the body says.
 */
const BODY_MESSAGE_STATUSES = new Set([400])

/**
 * Pull the human-readable reason out of an error response body.
 *
 * Without this a fixable input mistake reached the operator as
 * `API error: 500`, indistinguishable from a server fault. Bodies that are
 * not JSON (HTML error pages, proxies) are dropped rather than shown as-is.
 */
export function extractApiErrorMessage(raw: string, status: number): string {
  if (!raw || !BODY_MESSAGE_STATUSES.has(status)) return ''
  try {
    const body = JSON.parse(raw) as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string') return body.error
    if (typeof body.message === 'string') return body.message
  } catch {
    // Not JSON — fall through to the status-only message.
  }
  return ''
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase()
  const csrfHeaders: Record<string, string> = {}
  if (MUTATING_METHODS.has(method)) {
    const token = getCsrfToken()
    if (token) csrfHeaders['X-CSRF-Token'] = token
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    // Send the HttpOnly session cookie with every request.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...adminSessionHeaders(),
      ...csrfHeaders,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new ApiError(res.status, extractApiErrorMessage(await res.text(), res.status))
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type FriendListParams = {
  offset?: string
  limit?: string | number
  tagId?: string
  accountId?: string
  search?: string
  /**
   * `false` でタグ enrich をスキップ。autocomplete 等で displayName/picture
   * しか使わない呼び出し向け。デフォルトは true（既存呼び出しの挙動維持）。
   */
  includeTags?: boolean
  /**
   * `true` で latestIncomingMessage / latestOutgoingAt / activeScenario /
   * handled を付与。L-step 風友だちリスト UI 用。デフォルトは false。
   */
  includeChatStatus?: boolean
  /** 並び替え。`oldest` で created_at ASC、未指定 / `recent` で DESC. */
  sort?: 'recent' | 'oldest'
  /** `unhandled` で「最新が未返信の incoming」だけに絞る (サーバ側 SQL filter). */
  handled?: 'unhandled'
}

export type FriendWithTags = Friend & { tags: Tag[] }
export type FollowerImportState = {
  version: 1
  capability: 'unknown' | 'available' | 'unavailable'
  phase: 'not_started' | 'importing_ids' | 'hydrating_profiles' | 'completed'
  eligibilityCheckedAt: string | null
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
  received: number
  imported: number
  reactivated: number
  claimedUnassigned: number
  alreadyPresent: number
  conflicts: number
  invalid: number
  profilesProcessed: number
  profilesUpdated: number
  profileErrors: number
  lastError: string | null
}
export type FriendFormSubmission = {
  id: string
  formId: string
  formName: string
  fields: Array<{ name: string; label: string }>
  data: Record<string, unknown>
  createdAt: string
}
export type FriendDetail = FriendWithTags & {
  formSubmissions: FriendFormSubmission[]
  /** 対応の状況。やり取りがまだ無い友だちでは null。 */
  support: {
    status: 'unread' | 'in_progress' | 'resolved'
    operatorName: string | null
    notes: string | null
  } | null
}
export type MileageSummary = {
  programId: string
  programName: string
  available: number
  pending: number
  lifetimeEarned: number
  spent: number
}
export type MileageHistoryItem = {
  id: string
  entryType: 'grant' | 'reversal' | 'spend' | 'expiration' | 'adjustment'
  status: 'pending' | 'available' | 'void'
  amount: number
  reason: string
  source: string
  sourceEventId: string | null
  occurredAt: string
}
export type MileageRule = {
  id: string
  name: string
  eventType: string
  source: string | null
  amount: number
  initialStatus: 'pending' | 'available'
  conditions: {
    dailyCapActions?: number
    uniquePerSubject?: boolean
    uniquePerSubjectPerDay?: boolean
    ignoreMultiplier?: boolean
    beneficiary?: 'actor' | 'referrer'
    uniquePerReferredFriend?: boolean
    uniquePerReferredFriendPerSubject?: boolean
  }
  isActive: boolean
  validFrom: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string
}
export type MileageAdminMember = {
  identityKey: string
  primaryFriendId: string
  displayName: string
  pictureUrl: string | null
  accountCount: number
  accountNames: string[]
  available: number
  pending: number
  lifetimeEarned: number
  actionCount: number
  messageCount: number
  linkClickCount: number
  formCount: number
  bookingCount: number
  webinarCount: number
  instagramCount: number
  followingDays: number
  unfollowCount: number
  referralMiles: number
  qualityReferralCount: number
  lastActivityAt: string | null
}
export type MileageAdminOverview = {
  summary: {
    totalMembers: number
    totalAvailable: number
    activeMembers30d: number
    totalActions: number
    queuedEvents: number
  }
  members: MileageAdminMember[]
  pagination: { total: number; limit: number; offset: number }
}
/** Friend list items, optionally hydrated with chat status (when ?includeChatStatus=true) */
export type FriendListItem = FriendWithTags & Partial<{
  latestIncomingMessage: { content: string; messageType: string; createdAt: string } | null
  latestOutgoingAt: string | null
  activeScenario: { name: string; status: string } | null
  handled: boolean
}>



/** 一覧画面の上部に出す数（タグ・テンプレート・シナリオ・リマインダ）。 */
export type ListStats = {
  tags: { total: number; unused: number; taggedFriends: number; assignedThisMonth: number }
  marks: {
    total: number
    inUse: number
    unanswered: number
    inProgress: number
    resolved: number
    changedLast7: number
  }
  searches: { total: number; limit: number }
  templates: {
    total: number
    inUse: number
    sentThisMonth: number
    unused90d: number
    clickRate: number | null
  }
  scenarios: {
    total: number
    active: number
    subscribers: number
    completed: number
    sentThisWeek: number
  }
  reminders: { total: number; active: number; waiting: number; sentThisMonth: number }
}

/** 一斉配信の一覧に出す数（設計 `V2 4-2 一斉配信`）。 */
export type BroadcastStats = {
  thisMonth: number
  scheduled: number
  delivered: number
  failed: number
  /** 過去28日の平均開封率（%）。20人未満の配信は平均から外している。 */
  openRate: number | null
}

/** 友だち画面の上部に出す数（設計 `V2 2-2 友だち`）。 */
export type FriendStats = {
  active: number
  total: number
  blockedByThem: number
  hiddenByUs: number
  unanswered: number
  resolved: number
  addedThisMonth: number
  addedLastMonth: number
}

/** 受信箱の上部に出す数（設計 `V2 2-1 受信箱`）。 */
export type InboxStats = {
  waiting: number
  /** 受信から初回返信までの平均（分）。記録が無ければ null。 */
  averageFirstReplyMinutes: number | null
  /** そのうち1時間以上待たせているもの。 */
  waitingOverAnHour: number
  mine: number
  todayInbound: number
  todayByChannel: { line: number; email: number }
}

/** ダッシュボードが1回で読む数（設計 `V2 1-1 ダッシュボード`）。 */
export type DashboardOverview = {
  period: 'today' | 'last7' | 'last28'
  /** 集計した時刻。カードごとの基準がずれていないことの手がかり。 */
  generatedAt: string
  friends: {
    active: number
    total: number
    blockedByThem: number
    hiddenByUs: number
    blockedBoth: number
  }
  inbox: {
    unanswered: number
    inProgress: number
    resolved: number
    oldestUnansweredMinutes: number | null
    /** 受信から初回返信までの平均（分）。記録が無ければ null。 */
    averageFirstReplyMinutes: number | null
  }
  delivery: {
    sent: number
    /** こちらから送った数と、受信への応答。LINEは課金の数え方が違う。 */
    push: number
    reply: number
    broadcasts: number
    quotaLimit: number | null
    quotaUsed: number | null
  }
  trend: Array<{
    date: string
    added: number
    blocked: number
    active: number
    /** 日次記録が無く、いまの友だちから逆算した日。 */
    estimated: boolean
  }>
  conversions: {
    total: number
    byPoint: Array<{ name: string; count: number }>
  }
}

export type EcCommerceOverview = {
  total: number
  processed: number
  failed: number
  skipped: number
  last24h: number
  lastReceivedAt: string | null
  byType: Array<{ eventType: string; label: string; count: number }>
}

export type EcCommerceEvent = {
  id: string
  externalEventId: string
  eventType: string
  eventLabel: string
  customerId: string | null
  friendId: string | null
  friendName: string | null
  orderNumber: string | null
  status: 'received' | 'processing' | 'processed' | 'skipped' | 'failed'
  errorMessage: string | null
  receivedAt: string
  processedAt: string | null
}

export type EcShipment = {
  id: string
  eventType: string
  eventLabel: string
  orderNumber: string | null
  friendId: string | null
  friendName: string | null
  /** 「鹿肉ミンチ × 2」のような一行。商品情報が無ければ空文字。 */
  items: string
  itemCount: number
  /** JSTの暦日（YYYY-MM-DD）。 */
  shipDate: string
  /** subscription = EC側の予定日、ordered_at = 注文日時からの算出。 */
  shipDateSource: 'subscription' | 'ordered_at'
}

export type EcShipmentList = {
  today: string
  tomorrow: string
  soon: EcShipment[]
  later: EcShipment[]
  soonCount: number
  laterCount: number
  scanned: number
  scanLimit: number
}

export type EcNotificationSetting = {
  eventType: string
  label: string
  isEnabled: boolean
  title: string | null
  introText: string
  outroText: string
  fixedFields: string[]
  fixedPreview: string
  updatedAt: string
}

export type NenCampaignSetting = {
  campaignKey: string
  label: string
  category: 'transactional' | 'follow_up' | 'column' | 'birthday'
  triggerEvent: string | null
  delayDays: number
  deliveryTime: string
  isEnabled: boolean
  title: string
  bodyText: string
  buttonLabel: string | null
  buttonUrl: string | null
  imageUrl: string | null
  updatedAt: string
}

export type NenColumn = {
  id: string
  externalId: string | null
  slug: string
  title: string
  category: string | null
  excerpt: string
  introText: string
  articleUrl: string
  imageUrl: string | null
  publishedAt: string | null
  deliveryStatus: 'draft' | 'scheduled' | 'queued' | 'sent'
  deliveryAt: string | null
  lineAccountId: string | null
  updatedAt: string
}

export type NenPetProfile = {
  id: string
  friendId: string
  customerId: string | null
  name: string
  animalType: 'dog' | 'cat' | 'other'
  gender: 'male' | 'female' | 'unknown'
  birthday: string | null
  ownerName: string | null
  lineUserId: string
}

export type NenFriendOverview = {
  friend: Record<string, unknown>
  member: Record<string, unknown> | null
  pets: Array<Record<string, unknown>>
  healthLogs: Array<Record<string, unknown>>
  photos: Array<Record<string, unknown>>
  pointLedger: Array<Record<string, unknown>>
  ecEvents: Array<Record<string, unknown>>
}

export type AdPlatform = {
  id: string
  /** meta / x / google / tiktok */
  name: string
  displayName: string | null
  /** 鍵は先頭と末尾だけ残して伏せてある。 */
  config: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type AdConversionLog = {
  id: string
  adPlatformId: string
  friendId: string
  eventName: string
  clickId: string | null
  clickIdType: string | null
  status: string
  errorMessage: string | null
  createdAt: string
}

export type SearchConsoleMetric = {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type SearchConsoleMetricRow = SearchConsoleMetric & { key: string }

export type SearchConsolePerformance = {
  status: 'connected'
  siteUrl: string
  startDate: string
  endDate: string
  rangeDays: number
  summary: SearchConsoleMetric
  previousSummary: SearchConsoleMetric
  daily: SearchConsoleMetricRow[]
  queries: SearchConsoleMetricRow[]
  pages: SearchConsoleMetricRow[]
  devices: SearchConsoleMetricRow[]
  fetchedAt: string
}

export type SearchConsoleSetup = {
  status: 'not_configured'
  siteUrl: string | null
  serviceAccountEmail: string | null
}

/** 集計の期間をクエリにする。省略時はサーバー側の既定（直近30日）に任せる。 */
function rangeQuery(params?: { from?: string; to?: string }): string {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const api = {
  searchConsole: {
    performance: (days: 7 | 28 | 90) =>
      fetchApi<ApiResponse<SearchConsolePerformance | SearchConsoleSetup>>(
        `/api/search-console/performance?days=${days}`,
      ),
  },
  friends: {
    list: (params?: FriendListParams) => {
      const query: Record<string, string> = {}
      if (params?.offset) query.offset = String(params.offset)
      if (params?.limit) query.limit = String(params.limit)
      if (params?.tagId) query.tagId = params.tagId
      if (params?.accountId) query.lineAccountId = params.accountId
      if (params?.search) query.search = params.search
      if (params?.includeTags === false) query.includeTags = 'false'
      if (params?.includeChatStatus) query.includeChatStatus = 'true'
      if (params?.sort) query.sort = params.sort
      if (params?.handled) query.handled = params.handled
      return fetchApi<ApiResponse<PaginatedResponse<FriendListItem>>>(
        '/api/friends?' + new URLSearchParams(query)
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<FriendDetail>>(`/api/friends/${id}`),
    mileage: (id: string, limit = 10) =>
      fetchApi<ApiResponse<{ summary: MileageSummary; history: MileageHistoryItem[] }>>(
        `/api/friends/${id}/mileage?limit=${limit}`,
      ),
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
  tags: {
    /** withCounts で friendCount 付き (JOIN 集計 — タグ管理ページ用)。 */
    list: (params?: { withCounts?: boolean }) =>
      fetchApi<ApiResponse<Tag[]>>(`/api/tags${params?.withCounts ? '?withCounts=1' : ''}`),
    create: (data: { name: string; color: string; groupId?: string | null }) =>
      fetchApi<ApiResponse<Tag>>('/api/tags', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** 名前・色・一覧に出すかを変える。分類とマイルは別の受け口が持っている。 */
    update: (id: string, data: { name?: string; color?: string; isStarred?: boolean }) =>
      fetchApi<ApiResponse<Tag>>(`/api/tags/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 並び順をまとめて書く。渡した順に 0,1,2… が振られる。 */
    reorder: (ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/tags/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ ids }),
      }),
    /** 所属する親分類を変える。null で未分類に戻す。 */
    setGroup: (id: string, groupId: string | null) =>
      fetchApi<ApiResponse<Tag>>(`/api/tags/${id}/group`, {
        method: 'PATCH',
        body: JSON.stringify({ groupId }),
      }),
    updateMileage: (id: string, data: {
      rewardMiles: number
      referralRewardMiles: number
      multiplierBps: number | null
      multiplierPriority: number
    }) =>
      fetchApi<ApiResponse<{ tag: Tag; queued: number }>>(`/api/tags/${id}/mileage`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/tags/${id}`, { method: 'DELETE' }),
  },
  /**
   * タグの親分類。経路が /api/tag-groups なのは /api/tags/:id と
   * 衝突させないため（/api/tags/groups だと :id に食われる）。
   */
  /**
   * 友だち情報欄。
   *
   * 差し込み名（fieldKey）と種類は作成時にしか決められない。後から変えると
   * 既存の値の意味が変わったり、テンプレートの差し込みが空になったりする。
   */
  friendFields: {
    list: (params?: { folderId?: string; withUsage?: boolean }) => {
      const q = new URLSearchParams()
      if (params?.folderId) q.set('folderId', params.folderId)
      if (params?.withUsage) q.set('withUsage', '1')
      const query = q.toString()
      return fetchApi<ApiResponse<FriendField[]>>(
        `/api/friend-fields${query ? `?${query}` : ''}`,
      )
    },
    create: (data: {
      name: string
      fieldKey: string
      type: FriendFieldType
      folderId?: string | null
      options?: string[] | null
      defaultValue?: string | null
      isPersonal?: boolean
      isStarred?: boolean
      displayOrder?: number
    }) =>
      fetchApi<ApiResponse<FriendField>>('/api/friend-fields', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<
        Pick<
          FriendField,
          'name' | 'folderId' | 'defaultValue' | 'isPersonal' | 'isStarred' | 'displayOrder'
        >
      > & { options?: string[] | null },
    ) =>
      fetchApi<ApiResponse<FriendField>>(`/api/friend-fields/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 値が入っていると 409 で人数が返る。force で消せる。 */
    delete: (id: string, opts?: { force?: boolean }) =>
      fetchApi<ApiResponse<null>>(
        `/api/friend-fields/${id}${opts?.force ? '?force=1' : ''}`,
        { method: 'DELETE' },
      ),
    /** 1人ぶんの全項目と値。個人情報は役割で絞られる。 */
    forFriend: (friendId: string) =>
      fetchApi<ApiResponse<{ items: FriendField[]; hiddenPersonalCount: number }>>(
        `/api/friends/${friendId}/fields`,
      ),
    /** まとめて更新。EC が正の項目は無視され warnings に理由が入る。 */
    saveForFriend: (friendId: string, values: Record<string, string | null>) =>
      fetchApi<ApiResponse<{ updated: number }> & { warnings?: string[] }>(
        `/api/friends/${friendId}/fields`,
        { method: 'PUT', body: JSON.stringify({ values }) },
      ),
    bulk: (data: { friendIds: string[]; fieldId: string; value: string | null }) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/friend-fields/bulk', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  /** 対応マーク。友だちの対応状況を運用側の言葉で持つ。 */
  supportMarks: {
    list: () =>
      fetchApi<ApiResponse<Array<SupportMark & { friendCount: number }>>>('/api/support-marks'),
    create: (data: {
      name: string
      color?: string
      isDefault?: boolean
      autoOnInbound?: boolean
      displayOrder?: number
    }) =>
      fetchApi<ApiResponse<SupportMark>>('/api/support-marks', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<Pick<SupportMark, 'name' | 'color' | 'isDefault' | 'autoOnInbound' | 'displayOrder'>>,
    ) =>
      fetchApi<ApiResponse<SupportMark>>(`/api/support-marks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 付いている人がいると 409。force で未設定に戻して消す。 */
    delete: (id: string, opts?: { force?: boolean }) =>
      fetchApi<ApiResponse<null>>(
        `/api/support-marks/${id}${opts?.force ? '?force=1' : ''}`,
        { method: 'DELETE' },
      ),
    setForFriend: (friendId: string, markId: string | null) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${friendId}/support-mark`, {
        method: 'PATCH',
        body: JSON.stringify({ markId }),
      }),
    bulk: (friendIds: string[], markId: string | null) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/friends/support-mark/bulk', {
        method: 'POST',
        body: JSON.stringify({ friendIds, markId }),
      }),
  },
  /** 保存した検索。上限50件。 */
  savedSearches: {
    list: (params?: { scope?: 'friends' | 'chats' | 'bookings' }) =>
      fetchApi<ApiResponse<SavedSearch[]>>(
        `/api/saved-searches${params?.scope ? `?scope=${params.scope}` : ''}`,
      ),
    create: (data: {
      name: string
      scope?: 'friends' | 'chats' | 'bookings'
      conditions: unknown
      isShared?: boolean
    }) =>
      fetchApi<ApiResponse<SavedSearch>>('/api/saved-searches', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; conditions?: unknown; isShared?: boolean }) =>
      fetchApi<ApiResponse<SavedSearch>>(`/api/saved-searches/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/saved-searches/${id}`, { method: 'DELETE' }),
  },
  /**
   * 機能のオン／オフ。account_settings の key/value に入る。
   * 切ったものだけが記録され、記録が無ければ有効。
   */
  featureSettings: {
    get: (accountId: string) =>
      fetchApi<ApiResponse<{ features: Record<string, boolean>; sidebarOrder: string[] | null }>>(
        `/api/settings/features?account_id=${encodeURIComponent(accountId)}`,
      ),
    save: (accountId: string, data: { features?: Record<string, boolean>; sidebarOrder?: string[] }) =>
      fetchApi<ApiResponse<null>>(
        `/api/settings/features?account_id=${encodeURIComponent(accountId)}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
  },
  /**
   * 集計。新しいテーブルは作らず、既にあるデータをその場で数える。
   * 外部APIを叩かないので、ここが外の障害で落ちることはない。
   */
  analytics: {
    messages: (params?: { from?: string; to?: string }) =>
      fetchApi<
        ApiResponse<
          Array<{
            date: string
            outgoing: number
            incoming: number
            /** 応答メッセージ。LINE の課金対象外 */
            reply: number
            /** プッシュ。LINE の課金対象 */
            push: number
            fromBroadcast: number
            fromScenario: number
          }>
        >
      >(`/api/analytics/messages${rangeQuery(params)}`),
    /** 測定中のURL。1回も押されていないものも返る */
    trackedLinks: (params?: { from?: string; to?: string }) =>
      fetchApi<
        ApiResponse<
          Array<{
            trackedLinkId: string
            name: string
            originalUrl: string
            shortCode: string | null
            tagName: string | null
            scenarioName: string | null
            isActive: boolean
            clicks: number
            uniqueFriends: number
          }>
        >
      >(`/api/analytics/tracked-links${rangeQuery(params)}`),
    linkClicks: (params?: { from?: string; to?: string }) =>
      fetchApi<
        ApiResponse<
          Array<{ trackedLinkId: string; name: string; clicks: number; uniqueFriends: number }>
        >
      >(`/api/analytics/link-clicks${rangeQuery(params)}`),
    broadcasts: (params?: { from?: string; to?: string }) =>
      fetchApi<
        ApiResponse<
          Array<{
            broadcastId: string
            name: string
            sentAt: string | null
            delivered: number | null
            uniqueImpression: number | null
            uniqueClick: number | null
            /** LINEの制約で20人未満は開封が取れない */
            suppressedByAudienceSize: boolean
          }>
        >
      >(`/api/analytics/broadcasts${rangeQuery(params)}`),
    cross: (fieldId: string) =>
      fetchApi<ApiResponse<Array<{ row: string; col: string; count: number }>>>(
        `/api/analytics/cross?fieldId=${encodeURIComponent(fieldId)}`,
      ),
  },
  /**
   * ログイン履歴。オーナーと管理者だけが見られる。
   * IPは末尾を伏せて返る。
   */
  loginAudit: {
    list: (params?: { userId?: string; action?: string; limit?: number }) => {
      const q = new URLSearchParams()
      if (params?.userId) q.set('userId', params.userId)
      if (params?.action) q.set('action', params.action)
      if (params?.limit) q.set('limit', String(params.limit))
      const query = q.toString()
      return fetchApi<
        ApiResponse<
          Array<{
            id: string
            adminUserId: string | null
            action: string
            screen: string | null
            ip: string | null
            result: string
            createdAt: string
          }>
        >
      >(`/api/login-audit${query ? `?${query}` : ''}`)
    },
  },
  /** 回答フォーム。 */
  forms: {
    list: () =>
      fetchApi<ApiResponse<Array<{ id: string; name: string; description: string | null }>>>(
        '/api/forms',
      ),
    get: (id: string) =>
      fetchApi<
        ApiResponse<{
          id: string
          name: string
          description: string | null
          fields: unknown
          onSubmitTagId: string | null
          onSubmitMessageType: string | null
          onSubmitMessageContent: string | null
          isActive: boolean
          submitCount: number
        }>
      >(`/api/forms/${id}`),
    update: (
      id: string,
      data: {
        name?: string
        description?: string | null
        fields?: unknown
        onSubmitTagId?: string | null
        onSubmitMessageType?: string | null
        onSubmitMessageContent?: string | null
        isActive?: boolean
      },
    ) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/forms/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
  /** NENコラム。 */
  nenColumns: {
    list: () =>
      fetchApi<
        ApiResponse<
          Array<{
            id: string
            slug: string
            title: string
            intro_text: string | null
            published_at: string | null
          }>
        >
      >('/api/nen-campaigns/columns'),
    /** コラムに添える紹介文。本文そのものはEC側にある。 */
    updateMessage: (id: string, introText: string) =>
      fetchApi<ApiResponse<null>>(`/api/nen-campaigns/columns/${id}/message`, {
        method: 'PUT',
        body: JSON.stringify({ introText }),
      }),
  },
  /** サイトスクリプト。自社サイトの行動を友だちに紐づける。 */
  siteTracking: {
    /** 計測が動いているかと、その内訳 */
    summary: () =>
      fetchApi<
        ApiResponse<{
          todayEvents: number
          todayPageViews: number
          linkedEvents: number
          unlinkedEvents: number
          pathCount: number
          eventTypeCount: number
          lastEventAt: string | null
        }>
      >('/api/site/summary'),
    pages: (params?: { from?: string; to?: string }) =>
      fetchApi<ApiResponse<Array<{ path: string; views: number; visitors: number }>>>(
        `/api/site/pages${rangeQuery(params)}`,
      ),
    friendEvents: (friendId: string) =>
      fetchApi<
        ApiResponse<
          Array<{
            id: string
            eventType: string
            path: string | null
            label: string | null
            occurredAt: string
          }>
        >
      >(`/api/friends/${friendId}/site-events`),
  },
  funnels: {
    list: () =>
      fetchApi<ApiResponse<Array<{ id: string; name: string; windowDays: number; createdAt: string }>>>(
        '/api/funnels',
      ),
    create: (data: {
      name: string
      windowDays?: number
      steps: Array<{ label: string; kind: string; match: unknown }>
    }) =>
      fetchApi<ApiResponse<{ id: string }>>('/api/funnels', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => fetchApi<ApiResponse<null>>(`/api/funnels/${id}`, { method: 'DELETE' }),
    result: (id: string, params?: { from?: string; to?: string }) =>
      fetchApi<
        ApiResponse<{
          funnel: { id: string; name: string }
          steps: Array<{
            stepOrder: number
            label: string
            reached: number
            conversionFromPrevious: number
          }>
        }>
      >(`/api/funnels/${id}/result${rangeQuery(params)}`),
  },
  /** メディアライブラリ。1か所に置いて使い回す。 */
  media: {
    list: (params?: { kind?: string; folderId?: string }) => {
      const q = new URLSearchParams()
      if (params?.kind) q.set('kind', params.kind)
      if (params?.folderId) q.set('folderId', params.folderId)
      const query = q.toString()
      return fetchApi<ApiResponse<MediaItem[]>>(`/api/media${query ? `?${query}` : ''}`)
    },
    /** data は base64。data: URL 形式でも受け付ける。 */
    upload: (data: {
      filename: string
      mimeType: string
      data: string
      folderId?: string | null
    }) =>
      fetchApi<ApiResponse<MediaItem>>('/api/media', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { filename?: string; folderId?: string | null }) =>
      fetchApi<ApiResponse<MediaItem>>(`/api/media/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    usages: (id: string) => fetchApi<ApiResponse<MediaUsage[]>>(`/api/media/${id}/usages`),
    /** 使用中は 409 で件数が返る。force で消せる。 */
    delete: (id: string, opts?: { force?: boolean }) =>
      fetchApi<ApiResponse<null>>(`/api/media/${id}${opts?.force ? '?force=1' : ''}`, {
        method: 'DELETE',
      }),
  },
  /** 共通情報。営業時間などを1か所で直す。 */
  commonVars: {
    list: () => fetchApi<ApiResponse<CommonVar[]>>('/api/common-vars'),
    create: (data: { name: string; varKey: string; type?: string; value?: string }) =>
      fetchApi<ApiResponse<CommonVar>>('/api/common-vars', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** varKey は変えられない（テンプレートの差し込みが空になるため）。 */
    update: (id: string, data: { name?: string; value?: string }) =>
      fetchApi<ApiResponse<CommonVar>>(`/api/common-vars/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/common-vars/${id}`, { method: 'DELETE' }),
    schedules: (id: string) =>
      fetchApi<ApiResponse<CommonVarSchedule[]>>(`/api/common-vars/${id}/schedules`),
    addSchedule: (id: string, data: { effectiveFrom: string; value: string }) =>
      fetchApi<ApiResponse<CommonVarSchedule>>(`/api/common-vars/${id}/schedules`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteSchedule: (id: string, scheduleId: string) =>
      fetchApi<ApiResponse<null>>(`/api/common-vars/${id}/schedules/${scheduleId}`, {
        method: 'DELETE',
      }),
  },
  /** 汎用フォルダ。一覧13画面で共通に使う。 */
  folders: {
    list: (kind?: string) =>
      fetchApi<ApiResponse<Folder[]>>(`/api/folders${kind ? `?kind=${kind}` : ''}`),
    create: (data: { kind: string; name: string; parentId?: string | null }) =>
      fetchApi<ApiResponse<Folder>>('/api/folders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; parentId?: string | null; displayOrder?: number }) =>
      fetchApi<ApiResponse<Folder>>(`/api/folders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 中身は消えず未分類に戻る。子フォルダは一緒に消える。 */
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/folders/${id}`, { method: 'DELETE' }),
  },
  tagGroups: {
    list: () => fetchApi<ApiResponse<TagGroup[]>>('/api/tag-groups'),
    create: (data: { name: string; sortOrder?: number }) =>
      fetchApi<ApiResponse<TagGroup>>('/api/tag-groups', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; sortOrder?: number }) =>
      fetchApi<ApiResponse<TagGroup>>(`/api/tag-groups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 消しても属していたタグは残り、未分類に戻る。 */
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/tag-groups/${id}`, { method: 'DELETE' }),
  },
  scenarios: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<
        ApiResponse<
          (Scenario & {
            stepCount?: number
            /** いま流れている人 */
            subscriberCount?: number
            /** 最後まで届いた人 */
            completedCount?: number
          })[]
        >
      >('/api/scenarios' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Scenario & { steps: ScenarioStep[] }>>(`/api/scenarios/${id}`),
    /** 並び順をまとめて書く。渡した順に 0,1,2… が振られる。 */
    reorder: (ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/scenarios/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ ids }),
      }),
    create: (data: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>) =>
      fetchApi<ApiResponse<Scenario>>('/api/scenarios', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>>) =>
      fetchApi<ApiResponse<Scenario>>(`/api/scenarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}`, { method: 'DELETE' }),
    addStep: (
      id: string,
      data: {
        stepOrder: number
        messageType: ScenarioStep['messageType']
        messageContent: string
        delayMinutes?: number
        offsetDays?: number
        offsetMinutes?: number
        deliveryTime?: string
        templateId?: string | null
        onReachTagId?: string | null
        afterSend?: 'continue' | 'pause'
      },
    ) =>
      fetchApi<ApiResponse<ScenarioStep>>(`/api/scenarios/${id}/steps`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateStep: (
      id: string,
      stepId: string,
      data: {
        stepOrder?: number
        messageType?: ScenarioStep['messageType']
        messageContent?: string
        delayMinutes?: number
        offsetDays?: number
        offsetMinutes?: number
        deliveryTime?: string
        templateId?: string | null
        onReachTagId?: string | null
        afterSend?: 'continue' | 'pause'
      },
    ) =>
      fetchApi<ApiResponse<ScenarioStep>>(`/api/scenarios/${id}/steps/${stepId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteStep: (id: string, stepId: string) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}/steps/${stepId}`, {
        method: 'DELETE',
      }),
    reorderSteps: (id: string, orders: { stepId: string; stepOrder: number }[]) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}/steps/reorder`, {
        method: 'POST',
        body: JSON.stringify({ orders }),
      }),
    preview: (id: string, startAt?: string) => {
      const q = startAt ? `?startAt=${encodeURIComponent(startAt)}` : ''
      return fetchApi<ApiResponse<{
        startAt: string
        steps: Array<{
          stepOrder: number
          deliveryAt: string
          deliveryAtLabel: string
          messageType: string
          messageContent: string
        }>
      }>>(`/api/scenarios/${id}/preview${q}`)
    },
    stats: (id: string) =>
      fetchApi<ApiResponse<{
        enrolledTotal: number
        activeNow: number
        completed: number
        paused: number
        steps: Array<{ stepOrder: number; reachedCount: number; reachRate: number }>
      }>>(`/api/scenarios/${id}/stats`),
  },
  broadcasts: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<ApiBroadcast[]>>('/api/broadcasts' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}`),
    create: (data: {
      title: string
      messageType: ApiBroadcast['messageType']
      messageContent: string
      messageBubbles?: BroadcastBubble[]
      targetType: ApiBroadcast['targetType']
      targetTagId?: string | null
      scheduledAt?: string | null
      status?: ApiBroadcast['status']
      lineAccountId?: string | null
      accountIds?: string[]
      dedupPriority?: string[]
      trackLinks?: boolean
      /** 何分かけて配るか。0（既定）は一気に送る */
      stealthSpreadMinutes?: number
    }, options?: { idempotencyKey?: string }) =>
      fetchApi<ApiResponse<ApiBroadcast>>('/api/broadcasts', {
        method: 'POST',
        headers: options?.idempotencyKey
          ? { 'Idempotency-Key': options.idempotencyKey }
          : undefined,
        body: JSON.stringify(data),
      }),
    /**
     * 送る前の確認。何人に届くかと、気をつけることを返す。
     * 送信は何もしない。
     */
    preflight: (data: {
      targetType: string
      targetTagId?: string | null
      lineAccountId?: string | null
      accountIds?: string[]
      messageContent?: string
    }) =>
      fetchApi<
        ApiResponse<{
          audienceCount: number
          hiddenExcluded: number
          warnings: Array<{ level: 'info' | 'warning'; message: string }>
        }>
      >('/api/broadcasts/preflight', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: {
        title?: string
        messageType?: ApiBroadcast['messageType']
        messageContent?: string
        targetType?: ApiBroadcast['targetType']
        targetTagId?: string | null
        scheduledAt?: string | null
        trackLinks?: boolean
      }
    ) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/broadcasts/${id}`, { method: 'DELETE' }),
    // 本送信は取り消せないため、サーバー側が確認ヘッダを要求する。
    // 画面の確認ダイアログを経たことをここで示す。
    send: (id: string) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}/send`, {
        method: 'POST',
        headers: IRREVERSIBLE_BROADCAST_HEADERS,
      }),
    getInsight: (id: string) =>
      fetchApi<ApiResponse<BroadcastInsight | null>>(`/api/broadcasts/${id}/insight`),
    fetchInsight: (id: string) =>
      fetchApi<ApiResponse<BroadcastInsight>>(`/api/broadcasts/${id}/fetch-insight`, { method: 'POST' }),
    testSend: (id: string) =>
      fetchApi<{ success: boolean; sent?: number; failed?: number; error?: string }>(`/api/broadcasts/${id}/test-send`, { method: 'POST' }),
    getProgress: (id: string) =>
      fetchApi<{ success: boolean; data?: { status: string; totalCount: number; successCount: number; batchOffset: number } }>(`/api/broadcasts/${id}/progress`),
    previewCount: (id: string) =>
      fetchApi<{
        success: boolean;
        data?: {
          count: number;
          perAccount?: Array<{ accountId: string; sendCount: number }>;
        };
        error?: string;
      }>(`/api/broadcasts/${id}/preview-count`),
    perAccountStats: (id: string) =>
      fetchApi<{
        success: boolean;
        data?: Array<{
          accountId: string;
          accountName: string;
          sent: number;
          uniqueImpression: number | null;
          uniqueClick: number | null;
        }>;
        error?: string;
      }>(`/api/broadcasts/${id}/per-account-stats`),
    sendSegment: (id: string, conditions: unknown) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}/send-segment`, {
        method: 'POST',
        headers: IRREVERSIBLE_BROADCAST_HEADERS,
        body: JSON.stringify({ conditions }),
      }),
    dedupPreview: (input: { accountIds: string[]; dedupPriority: string[]; targetTagId?: string | null }) =>
      fetchApi<{
        success: boolean;
        data?: {
          totalSelected: number;
          uniqueRecipients: number;
          reduction: number;
          reductionRate: number;
          perAccount: Array<{
            accountId: string;
            accountName: string;
            accountCountry: string | null;
            selectedCount: number;
            sendCount: number;
            excludedToHigherPriority: number;
          }>;
        };
        error?: string;
      }>('/api/broadcasts/dedup-preview', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  broadcastMessageAssets: {
    list: (params?: { accountId?: string; kind?: BroadcastAssetKind }) => {
      const query = new URLSearchParams()
      if (params?.accountId) query.set('lineAccountId', params.accountId)
      if (params?.kind) query.set('kind', params.kind)
      const suffix = query.size ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<BroadcastMessageAsset[]>>(`/api/broadcast-message-assets${suffix}`)
    },
    create: (data: { lineAccountId?: string | null; kind: BroadcastAssetKind; name: string; payload: Record<string, unknown> }) =>
      fetchApi<ApiResponse<BroadcastMessageAsset>>('/api/broadcast-message-assets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name: string; payload: Record<string, unknown> }) =>
      fetchApi<ApiResponse<BroadcastMessageAsset>>(`/api/broadcast-message-assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/broadcast-message-assets/${id}`, { method: 'DELETE' }),
    upload: (file: File) =>
      fetchApi<ApiResponse<{ key: string; url: string; mimeType: string; size: number }>>('/api/broadcast-message-assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      }),
  },

  segments: {
    count: (conditions: unknown, accountId?: string) =>
      fetchApi<{ success: boolean; count?: number; error?: string }>('/api/segments/count', {
        method: 'POST',
        body: JSON.stringify({ conditions, accountId }),
      }),
  },

  accountSettings: {
    getTestRecipients: (accountId: string) =>
      fetchApi<{ success: boolean; data: Array<{ id: string; displayName: string; pictureUrl: string | null }> }>(`/api/account-settings/test-recipients?accountId=${accountId}`),
    getTestRecipientLoginUsers: (accountId: string) =>
      fetchApi<{
        success: boolean
        data: Array<{
          id: string
          displayName: string
          pictureUrl: string | null
          staffName: string
          sameAccount: boolean
        }>
      }>(`/api/account-settings/test-recipient-login-users?accountId=${accountId}`),
    updateTestRecipients: (accountId: string, friendIds: string[]) =>
      fetchApi<{ success: boolean }>('/api/account-settings/test-recipients', {
        method: 'PUT',
        body: JSON.stringify({ accountId, friendIds }),
      }),
    getLinkBaseUrl: () =>
      fetchApi<{ success: boolean; data: string | null }>('/api/account-settings/link-base-url'),
    updateLinkBaseUrl: (value: string) =>
      fetchApi<{ success: boolean; error?: string }>('/api/account-settings/link-base-url', {
        method: 'PUT',
        body: JSON.stringify({ value }),
      }),
    getTrackedLinkBaseUrl: () =>
      fetchApi<{ success: boolean; data: string | null }>('/api/account-settings/tracked-link-base-url'),
    updateTrackedLinkBaseUrl: (value: string) =>
      fetchApi<{ success: boolean; error?: string }>('/api/account-settings/tracked-link-base-url', {
        method: 'PUT',
        body: JSON.stringify({ value }),
      }),
  },

  // ── Round 2 APIs ─────────────────────────────────────────────────────────
  users: {
    list: () =>
      fetchApi<ApiResponse<User[]>>('/api/users'),
    get: (id: string) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`),
    create: (data: { email?: string | null; phone?: string | null; externalId?: string | null; displayName?: string | null }) =>
      fetchApi<ApiResponse<User>>('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<User, 'email' | 'phone' | 'externalId' | 'displayName'>>) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${id}`, { method: 'DELETE' }),
    link: (userId: string, friendId: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${userId}/link`, {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      }),
    accounts: (userId: string) =>
      fetchApi<ApiResponse<{ id: string; lineUserId: string; displayName: string | null; isFollowing: boolean }[]>>(
        `/api/users/${userId}/accounts`,
      ),
  },
  /**
   * ログインする前に呼べるもの。認証を通さないので、置けるのは
   * 「誰に見えても困らない値」に限る。
   */
  publicBrand: {
    /** 公式アカウントの表示名とアイコン。ログイン画面とタブの題に使う。 */
    get: () =>
      fetchApi<ApiResponse<{ name: string | null; iconUrl: string | null }>>('/api/public/brand'),
  },
  lineAccounts: {
    list: () =>
      fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
    get: (id: string) =>
      fetchApi<ApiResponse<LineAccount>>(`/api/line-accounts/${id}`),
    create: (data: {
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
      ogSiteName?: string | null;
      ogDefaultImageUrl?: string | null;
      ogDefaultDescription?: string | null;
    }) =>
      fetchApi<ApiResponse<LineAccount>>('/api/line-accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // Smart method routing:
    //   - rotating Messaging credentials (channelAccessToken / channelSecret)
    //     requires PUT (owner-only on the worker)
    //   - everything else routes to PATCH (admin-allowed)
    // This keeps a single helper signature for callers (toggle, country/role
    // edit, the edit modal) while letting admin users actually save the
    // non-credential changes. Without this, admin saves on the edit modal
    // would 403 even though the worker has a PATCH route that would accept
    // them.
    update: (
      id: string,
      data: Partial<
        Pick<
          LineAccount,
          | 'name'
          | 'channelAccessToken'
          | 'channelSecret'
          | 'loginChannelId'
          | 'loginChannelSecret'
          | 'liffId'
          | 'isActive'
          | 'country'
          | 'role'
          | 'ogSiteName'
          | 'ogDefaultDescription'
          | 'ogDefaultImageUrl'
          | 'friendCapacity'
          | 'capacityWarnAt'
          | 'iconUrl'
        >
      >,
    ) => {
      const touchesMessagingCredentials =
        data.channelAccessToken !== undefined || data.channelSecret !== undefined
      return fetchApi<ApiResponse<LineAccount>>(`/api/line-accounts/${id}`, {
        method: touchesMessagingCredentials ? 'PUT' : 'PATCH',
        body: JSON.stringify(data),
      })
    },
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/line-accounts/${id}`, { method: 'DELETE' }),
    updateOrder: (ordered: Array<{ id: string; displayOrder: number }>) =>
      fetchApi<{ success: boolean; error?: string }>('/api/line-accounts/order', {
        method: 'PATCH',
        body: JSON.stringify({ ordered }),
      }),
    followerImportState: (id: string) =>
      fetchApi<ApiResponse<FollowerImportState>>(`/api/line-accounts/${id}/follower-import`),
    detectFollowerImport: (id: string) =>
      fetchApi<ApiResponse<FollowerImportState>>(
        `/api/line-accounts/${id}/follower-import/detect`,
        { method: 'POST' },
      ),
    startFollowerImport: (id: string) =>
      fetchApi<ApiResponse<FollowerImportState>>(
        `/api/line-accounts/${id}/follower-import/start`,
        { method: 'POST' },
      ),
    stepFollowerImport: (id: string) =>
      fetchApi<ApiResponse<{ state: FollowerImportState; busy: boolean }>>(
        `/api/line-accounts/${id}/follower-import/step`,
        { method: 'POST' },
      ),
  },
  conversions: {
    points: () =>
      fetchApi<ApiResponse<ConversionPoint[]>>('/api/conversions/points'),
    createPoint: (data: {
      name: string
      eventType: string
      value?: number | null
      measureMethod?: ConversionMeasureMethod
      /** url_reach のときは必須。前方一致で判定する */
      targetUrl?: string | null
      /** false で「一人一回だけ数える」 */
      countRepeat?: boolean
      attributionDays?: number | null
      lineAccountId?: string | null
    }) =>
      fetchApi<ApiResponse<ConversionPoint>>('/api/conversions/points', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** 送った項目だけを書き換える。 */
    updatePoint: (id: string, data: {
      name?: string
      eventType?: string
      value?: number | null
      measureMethod?: ConversionMeasureMethod
      targetUrl?: string | null
      countRepeat?: boolean
      attributionDays?: number | null
      lineAccountId?: string | null
    }) =>
      fetchApi<ApiResponse<ConversionPoint>>(`/api/conversions/points/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deletePoint: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/conversions/points/${id}`, { method: 'DELETE' }),
    track: (data: { conversionPointId: string; friendId: string; userId?: string | null; affiliateCode?: string | null; metadata?: Record<string, unknown> | null }) =>
      fetchApi<ApiResponse<unknown>>('/api/conversions/track', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    report: (params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<{ conversionPointId: string; conversionPointName: string; eventType: string; totalCount: number; totalValue: number }[]>>(
        '/api/conversions/report?' + new URLSearchParams(params as Record<string, string>),
      ),
  },
  affiliates: {
    list: () =>
      fetchApi<ApiResponse<Affiliate[]>>('/api/affiliates'),
    get: (id: string) =>
      fetchApi<ApiResponse<Affiliate>>(`/api/affiliates/${id}`),
    // Admin-side create. Codes are auto-generated (random) — no manual `code`
    // needed. Pass `friendId` to bind 1:1 to a LINE friend; the response then
    // includes an issued `link` (refCode + url) unless issueInitialLink=false.
    // The legacy explicit `code` form still works for OSS back-compat.
    create: (data: {
      name?: string
      code?: string
      commissionRate?: number
      friendId?: string
      issueInitialLink?: boolean
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
          | 'name'
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
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/affiliates/${id}`, { method: 'DELETE' }),
    report: (id: string, params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<{ affiliateId: string; affiliateName: string; code: string; commissionRate: number; totalClicks: number; totalConversions: number; totalRevenue: number }>>(
        `/api/affiliates/${id}/report?` + new URLSearchParams(params as Record<string, string>),
      ),
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
        linkCount: number;
        friendAdds: number;
      }>>>('/api/affiliates-report?' + new URLSearchParams(params as Record<string, string>)),
  },
  templates: {
    list: (category?: string) =>
      fetchApi<ApiResponse<Array<{
        id: string;
        name: string;
        category: string;
        messageType: string;
        messageContent: string;
        usageCount: number;
        createdAt: string;
        updatedAt: string;
      }>>>(
        '/api/templates' + (category ? '?' + new URLSearchParams({ category }) : ''),
      ),
    get: (id: string) =>
      fetchApi<ApiResponse<{
        id: string;
        name: string;
        category: string;
        messageType: string;
        messageContent: string;
        usedBy: {
          autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>;
          automations: Array<{ id: string; name: string; eventType: string }>;
        };
        createdAt: string;
        updatedAt: string;
      }>>(
        `/api/templates/${id}`,
      ),
    create: (data: { name: string; category: string; messageType: string; messageContent: string }) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        '/api/templates',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    update: (id: string, data: Partial<{ name: string; category: string; messageType: string; messageContent: string }>) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        `/api/templates/${id}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/templates/${id}`, { method: 'DELETE' }),
    usages: (id: string) =>
      fetchApi<ApiResponse<{
        autoReplies: Array<{ id: string; keyword: string; lineAccountId: string | null }>;
        scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepId: string; stepOrder: number }>;
      }>>(`/api/templates/${id}/usages`),
  },
  autoReplies: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?accountId=' + encodeURIComponent(params.accountId) : ''
      return fetchApi<ApiResponse<Array<{
        id: string;
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
        activeFrom: string | null;
        activeUntil: string | null;
        cooldownMinutes: number | null;
        skipWhenOperatorActive: boolean;
        priority: number;
        messageKinds: string[] | null;
        createdAt: string;
        effectiveAccounts?: Array<{
          accountId: string;
          accountName: string;
          status: 'reply' | 'silent' | 'not_applicable';
          via: 'inline' | 'automation' | null;
        }>;
      }>>>('/api/auto-replies' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<{
        id: string;
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
        activeFrom: string | null;
        activeUntil: string | null;
        cooldownMinutes: number | null;
        skipWhenOperatorActive: boolean;
        priority: number;
        messageKinds: string[] | null;
        createdAt: string;
      }>>(`/api/auto-replies/${id}`),
    create: (body: {
      keyword: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
      /** JST の "HH:MM"。null で時間帯を問わない */
      activeFrom?: string | null;
      activeUntil?: string | null;
      /** この分数は同じ相手へ自動応答を返さない。null/0 で抑制しない */
      cooldownMinutes?: number | null;
      /** 担当者が対応中のトークでは返さない */
      skipWhenOperatorActive?: boolean;
      /** 評価順。小さいほど先に見る */
      priority?: number;
      /** 対象にするメッセージ種別。null で全部 */
      messageKinds?: string[] | null;
    }) =>
      fetchApi<ApiResponse<{ id: string }>>('/api/auto-replies', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: {
      keyword?: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
      isActive?: boolean;
      activeFrom?: string | null;
      activeUntil?: string | null;
      cooldownMinutes?: number | null;
      skipWhenOperatorActive?: boolean;
      priority?: number;
      messageKinds?: string[] | null;
    }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/auto-replies/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/auto-replies/${id}`, {
        method: 'DELETE',
      }),
  },
  automations: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Automation[]>>('/api/automations' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Automation & { logs?: AutomationLog[] }>>(`/api/automations/${id}`),
    create: (data: {
      name: string
      eventType: Automation['eventType']
      actions: Automation['actions']
      description?: string | null
      conditions?: Record<string, unknown>
      priority?: number
    }) =>
      fetchApi<ApiResponse<Automation>>('/api/automations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Automation, 'name' | 'description' | 'eventType' | 'conditions' | 'actions' | 'isActive' | 'priority'>>) =>
      fetchApi<ApiResponse<Automation>>(`/api/automations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/automations/${id}`, { method: 'DELETE' }),
    logs: (id: string, limit?: number) =>
      fetchApi<ApiResponse<AutomationLog[]>>(
        `/api/automations/${id}/logs` + (limit ? `?limit=${limit}` : ''),
      ),
  },
  chatStats: {
    get: () => fetchApi<ApiResponse<InboxStats>>('/api/chats/stats'),
  },
  listStats: {
    get: () => fetchApi<ApiResponse<ListStats>>('/api/list-stats'),
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
  dashboard: {
    overview: (params?: { period?: 'today' | 'last7' | 'last28'; accountId?: string }) => {
      const query = new URLSearchParams()
      if (params?.period) query.set('period', params.period)
      if (params?.accountId) query.set('accountId', params.accountId)
      const suffix = query.size ? `?${query}` : ''
      return fetchApi<ApiResponse<DashboardOverview>>(`/api/dashboard/overview${suffix}`)
    },
  },
  ecCommerce: {
    overview: () =>
      fetchApi<ApiResponse<EcCommerceOverview>>('/api/ec-commerce/overview'),
    events: (params?: { eventType?: string; status?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.eventType) query.set('eventType', params.eventType)
      if (params?.status) query.set('status', params.status)
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.offset !== undefined) query.set('offset', String(params.offset))
      const suffix = query.size ? `?${query}` : ''
      return fetchApi<ApiResponse<EcCommerceEvent[]> & { pagination: { total: number; limit: number; offset: number } }>(
        `/api/ec-commerce/events${suffix}`,
      )
    },
    settings: () =>
      fetchApi<ApiResponse<EcNotificationSetting[]>>('/api/ec-commerce/settings'),
    updateSetting: (eventType: string, data: { isEnabled: boolean; title: string; introText: string; outroText: string }) =>
      fetchApi<{ success: boolean }>(`/api/ec-commerce/settings/${encodeURIComponent(eventType)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    testSend: (data: { eventType: string; accountId: string; title: string; introText: string; outroText: string }) =>
      fetchApi<ApiResponse<{ sent: number }>>('/api/ec-commerce/test-send', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    shipments: (params?: { limit?: number }) => {
      const suffix = params?.limit === undefined ? '' : `?limit=${params.limit}`
      return fetchApi<ApiResponse<EcShipmentList>>(`/api/ec-commerce/shipments${suffix}`)
    },
  },
  /**
   * 友だち追加時の配信の振り分け（設計 V2 4-6）。
   *
   * `configured: false` は「まだ決めていない」。このときは従来どおり
   * 有効な friend_add シナリオが全部流れている。
   */
  friendAddRouting: {
    get: (accountId: string) =>
      fetchApi<ApiResponse<{
        configured: boolean
        routing: FriendAddRouting
        scenarios: { id: string; name: string }[]
        tags: { id: string; name: string }[]
      }>>(`/api/friend-add-routing?account_id=${encodeURIComponent(accountId)}`),
    save: (accountId: string, routing: FriendAddRouting) =>
      fetchApi<ApiResponse<{ routing: FriendAddRouting }>>(
        `/api/friend-add-routing?account_id=${encodeURIComponent(accountId)}`,
        { method: 'PUT', body: JSON.stringify({ routing }) },
      ),
    /** テスト実行。登録も配信もしない。振り分け先だけを返す。 */
    test: (accountId: string, friendId: string) =>
      fetchApi<ApiResponse<{
        configured: boolean
        kind: 'first_time' | 'returning'
        scenarioId: string | null
        suppressed: boolean
        displayName: string | null
        unfollowCount: number
        firstFollowedAt: string | null
      }>>(`/api/friend-add-routing/test?account_id=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      }),
  },
  nenCampaigns: {
    overview: () => fetchApi<ApiResponse<{
      activeCampaigns: number
      jobs: { total: number; pending: number; sent: number; failed: number }
      columns: number
      pets: number
      coupons: number
    }>>('/api/nen-campaigns/overview'),
    settings: () => fetchApi<ApiResponse<NenCampaignSetting[]>>('/api/nen-campaigns/settings'),
    updateSetting: (campaignKey: string, data: Pick<NenCampaignSetting,
      'isEnabled' | 'title' | 'bodyText' | 'delayDays' | 'deliveryTime' | 'buttonLabel' | 'buttonUrl' | 'imageUrl'>) =>
      fetchApi<{ success: boolean }>(`/api/nen-campaigns/settings/${encodeURIComponent(campaignKey)}`, {
        method: 'PUT', body: JSON.stringify(data),
      }),
    testSend: (data: { campaignKey: string; accountId: string; friendId: string }) =>
      fetchApi<{ success: boolean }>('/api/nen-campaigns/test-send', { method: 'POST', body: JSON.stringify(data) }),
    jobs: () => fetchApi<ApiResponse<Array<{
      id: string; campaignKey: string; label: string; friendName: string | null
      scheduledAt: string; status: string; attempts: number; lastError: string | null; sentAt: string | null
    }>>>('/api/nen-campaigns/jobs'),
    columns: () => fetchApi<ApiResponse<NenColumn[]>>('/api/nen-campaigns/columns'),
    deliverColumn: (id: string, data: { accountId: string; scheduledAt?: string }) =>
      fetchApi<ApiResponse<{ queued: number }>>(`/api/nen-campaigns/columns/${encodeURIComponent(id)}/deliver`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    updateColumnMessage: (id: string, introText: string) =>
      fetchApi<{ success: boolean }>(`/api/nen-campaigns/columns/${encodeURIComponent(id)}/message`, {
        method: 'PUT', body: JSON.stringify({ introText }),
      }),
    pets: (search?: string) => fetchApi<ApiResponse<NenPetProfile[]>>(
      `/api/nen-campaigns/pets${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
    createPet: (data: { friendId: string; customerId?: string; name: string; animalType: string; gender: string; birthday?: string }) =>
      fetchApi<ApiResponse<{ id: string }>>('/api/nen-campaigns/pets', { method: 'POST', body: JSON.stringify(data) }),
    updatePet: (id: string, data: { name: string; animalType: string; gender: string; birthday?: string }) =>
      fetchApi<{ success: boolean }>(`/api/nen-campaigns/pets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    deletePet: (id: string) => fetchApi<{ success: boolean }>(`/api/nen-campaigns/pets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    birthdayCoupon: () => fetchApi<ApiResponse<{
      isEnabled: boolean; codePrefix: string; benefitLabel: string; discountAmount: number; validityDays: number; updatedAt: string
    }>>('/api/nen-campaigns/birthday-coupon'),
    updateBirthdayCoupon: (data: { isEnabled: boolean; codePrefix: string; benefitLabel: string; discountAmount: number; validityDays: number }) =>
      fetchApi<{ success: boolean }>('/api/nen-campaigns/birthday-coupon', { method: 'PUT', body: JSON.stringify(data) }),
  },
  nenMembers: {
    overview: () => fetchApi<ApiResponse<{ pets: number; healthLogs: number; activeCare: number; pendingPhotos: number; members: number; consultations: number }>>('/api/nen-members/overview'),
    careFlags: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/care-flags'),
    updateCareFlag: (id: string, data: { status: 'active' | 'resolved'; adviceReady: boolean }) => fetchApi<{ success: boolean }>(`/api/nen-members/care-flags/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    photos: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/photos'),
    reviewPhoto: (id: string, data: { status: 'adopted' | 'rejected'; points: number }) => fetchApi<ApiResponse<{ awardedPoints: number; pointBalance: number | null; pointSync: string }>>(`/api/nen-members/photos/${encodeURIComponent(id)}/review`, { method: 'PUT', body: JSON.stringify(data) }),
    friendOverview: (friendId: string) => fetchApi<ApiResponse<NenFriendOverview>>(`/api/nen-members/friends/${encodeURIComponent(friendId)}`),
    ranks: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/ranks'),
    consultations: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/consultations'),
    installRichMenu: (accountId: string) => fetchApi<ApiResponse<{ richMenuId: string; liffId: string }>>('/api/nen-members/rich-menu/install', { method: 'POST', body: JSON.stringify({ accountId }) }),
  },
  chats: {
    list: (params?: { status?: string; operatorId?: string; accountId?: string; unansweredOnly?: boolean; limit?: number; beforeAt?: string; beforeId?: string }) => {
      const query: Record<string, string> = {}
      if (params?.status) query.status = params.status
      if (params?.operatorId) query.operatorId = params.operatorId
      if (params?.accountId) query.lineAccountId = params.accountId
      if (params?.unansweredOnly) query.unansweredOnly = '1'
      if (params?.limit !== undefined) query.limit = String(params.limit)
      // カーソルページング: (lastMessageAt, friendId) の複合カーソルより古い行を返す
      if (params?.beforeAt) query.beforeAt = params.beforeAt
      if (params?.beforeId) query.beforeId = params.beforeId
      return fetchApi<ApiResponse<Chat[]>>(
        '/api/chats?' + new URLSearchParams(query),
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Chat & { messages?: { id: string; content: string; senderType: string; createdAt: string }[] }>>(
        `/api/chats/${id}`,
      ),
    create: (data: { friendId: string; operatorId?: string | null }) =>
      fetchApi<ApiResponse<Chat>>('/api/chats', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { operatorId?: string | null; status?: Chat['status']; notes?: string | null }) =>
      fetchApi<ApiResponse<Chat>>(`/api/chats/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    send: (id: string, data: { content: string; messageType?: string }) =>
      fetchApi<ApiResponse<unknown>>(`/api/chats/${id}/send`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  reminders: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Reminder[]>>('/api/reminders' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Reminder & { steps: ReminderStep[] }>>(`/api/reminders/${id}`),
    create: (data: {
      name: string
      description?: string | null
      triggerType?: ReminderTriggerType
      triggerOffsetMinutes?: number | null
      sendAtTime?: string | null
      targetTagId?: string | null
    }) =>
      fetchApi<ApiResponse<Reminder>>('/api/reminders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<
        Pick<
          Reminder,
          | 'name'
          | 'description'
          | 'isActive'
          | 'triggerType'
          | 'triggerOffsetMinutes'
          | 'sendAtTime'
          | 'targetTagId'
        >
      >,
    ) =>
      fetchApi<ApiResponse<Reminder>>(`/api/reminders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${id}`, { method: 'DELETE' }),
    addStep: (id: string, data: { offsetMinutes: number; messageType: string; messageContent: string }) =>
      fetchApi<ApiResponse<ReminderStep>>(`/api/reminders/${id}/steps`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteStep: (reminderId: string, stepId: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${reminderId}/steps/${stepId}`, {
        method: 'DELETE',
      }),
  },
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
      fetchApi<ApiResponse<{ totalScore: number; history: { id: string; scoreChange: number; reason: string | null; createdAt: string }[] }>>(
        `/api/friends/${friendId}/score`,
      ),
  },
  mileage: {
    overview: (params?: { accountId?: string; search?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.accountId) query.set('accountId', params.accountId)
      if (params?.search) query.set('search', params.search)
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.offset !== undefined) query.set('offset', String(params.offset))
      const suffix = query.toString() ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<MileageAdminOverview>>(`/api/mileage/overview${suffix}`)
    },
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
    }) => fetchApi<ApiResponse<MileageRule>>('/api/mileage/rules', {
      method: 'POST',
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
  webhooks: {
    incoming: {
      list: () =>
        fetchApi<ApiResponse<IncomingWebhook[]>>('/api/webhooks/incoming'),
      create: (data: { name: string; sourceType?: string; secret: string }) =>
        fetchApi<ApiResponse<IncomingWebhookCreated>>('/api/webhooks/incoming', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<IncomingWebhook, 'name' | 'sourceType' | 'isActive'>> & { secret?: string }) =>
        fetchApi<ApiResponse<IncomingWebhook>>(`/api/webhooks/incoming/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/webhooks/incoming/${id}`, { method: 'DELETE' }),
    },
    outgoing: {
      list: () =>
        fetchApi<ApiResponse<OutgoingWebhook[]>>('/api/webhooks/outgoing'),
      create: (data: { name: string; url: string; eventTypes: string[]; secret: string; maxRetries?: number }) =>
        fetchApi<ApiResponse<OutgoingWebhookCreated>>('/api/webhooks/outgoing', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (
        id: string,
        data: Partial<Pick<OutgoingWebhook, 'name' | 'url' | 'eventTypes' | 'isActive' | 'maxRetries'>> & { secret?: string },
      ) =>
        fetchApi<ApiResponse<OutgoingWebhook>>(`/api/webhooks/outgoing/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/webhooks/outgoing/${id}`, { method: 'DELETE' }),
    },
  },
  notifications: {
    rules: {
      list: () =>
        fetchApi<ApiResponse<NotificationRule[]>>('/api/notifications/rules'),
      get: (id: string) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`),
      create: (data: { name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }) =>
        fetchApi<ApiResponse<NotificationRule>>('/api/notifications/rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<NotificationRule, 'name' | 'eventType' | 'conditions' | 'channels' | 'isActive'>>) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/notifications/rules/${id}`, { method: 'DELETE' }),
    },
    list: (params?: { status?: string; limit?: string }) =>
      fetchApi<ApiResponse<Notification[]>>(
        '/api/notifications?' + new URLSearchParams(params as Record<string, string>),
      ),
  },
  health: {
    accounts: () =>
      fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
    getHealth: (accountId: string) =>
      fetchApi<ApiResponse<{ riskLevel: string; logs: AccountHealthLog[] }>>(
        `/api/accounts/${accountId}/health`,
      ),
    migrations: () =>
      fetchApi<ApiResponse<AccountMigration[]>>('/api/accounts/migrations'),
    migrate: (fromAccountId: string, data: { toAccountId: string }) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/${fromAccountId}/migrate`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getMigration: (migrationId: string) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/migrations/${migrationId}`),
  },
  staff: {
    list: () =>
      fetchApi<ApiResponse<StaffMember[]>>('/api/staff'),
    get: (id: string) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}`),
    me: () =>
      fetchApi<ApiResponse<{ id: string; name: string; role: string; email: string | null }>>('/api/staff/me'),
    create: (data: { name: string; email?: string; role: 'admin' | 'staff' | 'viewer' }) =>
      fetchApi<ApiResponse<StaffMember>>('/api/staff', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; email?: string | null; role?: string; isActive?: boolean }) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/staff/${id}`, { method: 'DELETE' }),
    regenerateKey: (id: string) =>
      fetchApi<ApiResponse<{ apiKey: string }>>(`/api/staff/${id}/regenerate-key`, { method: 'POST' }),
  },
  usersGrouped: {
    list: (opts?: {
      q?: string;
      onlyDups?: boolean;
      account?: string;
      page?: number;
      pageSize?: number;
      forceRefresh?: boolean;
    }) => {
      const p = new URLSearchParams();
      if (opts?.q) p.set('q', opts.q);
      if (opts?.onlyDups) p.set('onlyDups', '1');
      if (opts?.account) p.set('account', opts.account);
      if (opts?.page) p.set('page', String(opts.page));
      if (opts?.pageSize) p.set('pageSize', String(opts.pageSize));
      if (opts?.forceRefresh) p.set('refresh', '1');
      const qs = p.toString();
      return fetchApi<ApiResponse<{
        total: number;
        page: number;
        pageSize: number;
        computedAt: string;
        rows: Array<{
          identityKey: string;
          identityKeyKind: 'url_token' | 'uid' | 'solo';
          displayName: string | null;
          pictureUrl: string | null;
          accounts: Array<{
            accountId: string;
            accountName: string;
            lineUserId: string;
            isFollowing: boolean;
            joinedAt: string;
            friendId: string;
          }>;
          xUsername: string | null;
          emails: string[];
          phones: string[];
          lastActivityAt: string;
          isDuplicate: boolean;
        }>;
      }>>(`/api/users-grouped${qs ? `?${qs}` : ''}`);
    },
  },
  inbox: {
    unanswered: {
      list: (opts?: {
        q?: string;
        account?: string;
        minWaitMinutes?: number;
        page?: number;
        pageSize?: number;
      }) => {
        const p = new URLSearchParams();
        if (opts?.q) p.set('q', opts.q);
        if (opts?.account) p.set('account', opts.account);
        if (opts?.minWaitMinutes) p.set('minWaitMinutes', String(opts.minWaitMinutes));
        if (opts?.page) p.set('page', String(opts.page));
        if (opts?.pageSize) p.set('pageSize', String(opts.pageSize));
        const qs = p.toString();
        return fetchApi<ApiResponse<{
          total: number;
          page: number;
          pageSize: number;
          rows: Array<{
            friendId: string;
            displayName: string | null;
            pictureUrl: string | null;
            accountId: string;
            accountName: string;
            lastIncomingAt: string;
            lastManualAt: string | null;
            lastMachineAt: string | null;
            lastIncomingType: string;
            lastIncomingContent: string;
          }>;
        }>>(`/api/inbox/unanswered${qs ? `?${qs}` : ''}`);
      },
      count: () =>
        fetchApi<ApiResponse<{
          total: number;
          byAccount: Array<{ accountId: string; accountName: string; count: number }>;
          oldestWaitMinutes: number | null;
        }>>('/api/inbox/unanswered/count'),
    },
  },
  richMenuGroups: {
    list: (accountId: string) =>
      fetchApi<ApiResponse<Array<{
        id: string;
        accountId: string;
        name: string;
        chatBarText: string;
        size: 'large' | 'compact';
        defaultPageId: string | null;
        isDefaultForAll: boolean;
        status: 'draft' | 'published';
        publishingAt: string | null;
        thumbnailR2Key: string | null;
        createdAt: string;
        updatedAt: string;
      }>>>(`/api/rich-menu-groups?accountId=${encodeURIComponent(accountId)}`),

    get: (groupId: string) =>
      fetchApi<ApiResponse<{
        id: string;
        accountId: string;
        name: string;
        chatBarText: string;
        size: 'large' | 'compact';
        defaultPageId: string | null;
        isDefaultForAll: boolean;
        status: 'draft' | 'published';
        publishingAt: string | null;
        createdAt: string;
        updatedAt: string;
        pages: Array<{
          id: string;
          orderIndex: number;
          name: string;
          aliasId: string;
          lineRichmenuId: string | null;
          imageR2Key: string | null;
          imageContentType: string | null;
          areas: Array<{
            id: string;
            boundsX: number;
            boundsY: number;
            boundsWidth: number;
            boundsHeight: number;
            actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
            actionData: Record<string, unknown>;
          }>;
        }>;
      }>>(`/api/rich-menu-groups/${groupId}`),

    create: (input: {
      accountId: string;
      name: string;
      chatBarText: string;
      size: 'large' | 'compact';
      pages: Array<{
        id?: string;
        name: string;
        orderIndex: number;
        areas: Array<{
          boundsX: number;
          boundsY: number;
          boundsWidth: number;
          boundsHeight: number;
          actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
          actionData: Record<string, unknown>;
        }>;
      }>;
    }) =>
      fetchApi<ApiResponse<{ id: string; pages: Array<{ id: string }> }>>('/api/rich-menu-groups', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    update: (groupId: string, input: {
      name?: string;
      chatBarText?: string;
      isDefaultForAll?: boolean;
      pages?: Array<{
        id?: string;
        name: string;
        orderIndex: number;
        areas: Array<{
          boundsX: number;
          boundsY: number;
          boundsWidth: number;
          boundsHeight: number;
          actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
          actionData: Record<string, unknown>;
        }>;
      }>;
    }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/rich-menu-groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    delete: (groupId: string, opts?: { force?: boolean }) =>
      fetchApi<ApiResponse<null>>(
        `/api/rich-menu-groups/${groupId}${opts?.force ? '?force=true' : ''}`,
        { method: 'DELETE' },
      ),

    publish: (groupId: string) =>
      fetchApi<ApiResponse<{ pages: Array<{ pageId: string; newRichMenuId: string }> }>>(
        `/api/rich-menu-groups/${groupId}/publish`,
        { method: 'POST' },
      ),

    unpublish: (groupId: string) =>
      fetchApi<ApiResponse<{
        pages: Array<{ pageId: string; clearedRichMenuId: string | null }>;
        warnings: string[];
      }>>(`/api/rich-menu-groups/${groupId}/unpublish`, { method: 'POST' }),

    external: (accountId: string) =>
      fetchApi<ApiResponse<{
        currentDefault: string | null;
        lineMenus: Array<{
          richMenuId: string;
          name: string;
          chatBarText: string;
          size: { width: number; height: number };
          areasCount: number;
          isCurrentDefault: boolean;
          adminManaged: boolean;
          adminInfo: {
            groupId: string;
            groupName: string;
            pageName: string;
            groupStatus: 'draft' | 'published';
          } | null;
        }>;
      }>>(`/api/rich-menu-groups/external?accountId=${encodeURIComponent(accountId)}`),

    deleteExternal: (richMenuId: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(
        `/api/rich-menu-groups/external/${richMenuId}?accountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
      ),

    importFromLine: (richMenuId: string, accountId: string) =>
      fetchApi<ApiResponse<{ id: string; name: string }>>(
        `/api/rich-menu-groups/import?accountId=${encodeURIComponent(accountId)}&richMenuId=${encodeURIComponent(richMenuId)}`,
        { method: 'POST' },
      ),

    // LINE 上の rich menu 画像を admin proxy 経由で取得する URL。
    // <img src> として使う。staff 認証必要 (admin 経由なので browser fetch すると
    // クッキーや Authorization が必要 — 代わりに admin が cache-busting できる
    // タイムスタンプを付けるパターンで利用)。
    externalImageUrl: (richMenuId: string, accountId: string) =>
      `${API_URL}/api/rich-menu-groups/external/${richMenuId}/image?accountId=${encodeURIComponent(accountId)}`,

    applyToTag: (
      groupId: string,
      params:
        | { mode: 'bulk-link'; tagId: string | null }
        | { mode: 'set-default' },
    ) =>
      fetchApi<
        ApiResponse<{ chunks: number; total: number; message?: string; mode?: string }>
      >(`/api/rich-menu-groups/${groupId}/apply-to-tag`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    // 画像 upload は Content-Type を image/* で送るので fetchApi を使わず直接 fetch。
    uploadImage: async (groupId: string, pageId: string, file: File) => {
      const csrf = getCsrfToken();
      const res = await fetch(
        `${API_URL}/api/rich-menu-groups/${groupId}/pages/${pageId}/image`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': file.type,
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: file,
        },
      );
      const body = (await res.json()) as ApiResponse<{
        imageR2Key: string;
        imageContentType: string;
        size: 'large' | 'compact';
      }>;
      if (!body.success) {
        throw new Error(body.error ?? `upload failed: ${res.status}`);
      }
      return body;
    },

    // 注: <img src> では Authorization ヘッダを送れないため、Worker 側で
    //   この path のみ auth ミドルウェアの除外パスに加えるか、
    //   あるいは将来的に署名付き URL を発行する仕組みに切り替える必要がある。
    //   v1 ではドラフト編集中のプレビュー用 = 認証バイパスでも実害は低いので、
    //   後続 PR で worker 側を whitelist 化する想定。
    imageUrl: (key: string) =>
      `${API_URL}/api/rich-menu-images/${encodeURIComponent(key)}`,
  },
  messageTemplates: {
    list: () =>
      fetchApi<ApiResponse<Array<{
        id: string
        name: string
        messageType: string
        messageContent: string
        createdAt: string
        updatedAt: string
      }>>>('/api/message-templates'),
  },
  entryRoutes: {
    list: () => fetchApi<ApiResponse<EntryRoute[]>>('/api/entry-routes'),
    get: (id: string) => fetchApi<ApiResponse<EntryRoute>>(`/api/entry-routes/${id}`),
    create: (data: CreateEntryRouteInput) =>
      fetchApi<ApiResponse<EntryRoute>>('/api/entry-routes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<CreateEntryRouteInput>) =>
      fetchApi<ApiResponse<EntryRoute>>(`/api/entry-routes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/entry-routes/${id}`, { method: 'DELETE' }),
    funnel: (id: string) =>
      fetchApi<ApiResponse<EntryRouteFunnel>>(`/api/entry-routes/${id}/funnel`),
    /** クリックがどこから来ているか。utm_source > 参照元のホスト > 直接アクセス */
    sources: (id: string) =>
      fetchApi<ApiResponse<Array<{ label: string; count: number }>>>(
        `/api/entry-routes/${id}/sources`,
      ),
  },
  entryRouteGenres: {
    list: () => fetchApi<ApiResponse<EntryRouteGenre[]>>('/api/entry-route-genres'),
    create: (name: string) =>
      fetchApi<ApiResponse<EntryRouteGenre>>('/api/entry-route-genres', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    update: (id: string, name: string) =>
      fetchApi<ApiResponse<EntryRouteGenre>>(`/api/entry-route-genres/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
  },
  // tracked_links は別管理だが /inflow-links 一覧で「(未登録)」誤表示を防ぐため
  // 同ページから参照する。Worker の applyRefAttribution は entry_routes → tracked_links
  // の順でフォールバックするので、tracked_links 登録済み ref は実際にはシナリオ発火している。
  trackedLinks: {
    list: () =>
      fetchApi<
        ApiResponse<
          Array<{
            id: string
            name: string
            originalUrl: string
            trackingUrl: string
            tagId: string | null
            scenarioId: string | null
            introTemplateId: string | null
            rewardTemplateId: string | null
            isActive: boolean
            clickCount: number
            createdAt: string
            updatedAt: string
          }>
        >
      >('/api/tracked-links'),
  },
  pools: {
    list: () => fetchApi<ApiResponse<TrafficPool[]>>('/api/traffic-pools'),
    get: (id: string) => fetchApi<ApiResponse<TrafficPool>>(`/api/traffic-pools/${id}`),
    create: (data: { slug: string; name: string; activeAccountId: string }) =>
      fetchApi<ApiResponse<TrafficPool>>('/api/traffic-pools', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<{ name: string; activeAccountId: string; isActive: boolean }>,
    ) =>
      fetchApi<ApiResponse<TrafficPool>>(`/api/traffic-pools/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/traffic-pools/${id}`, { method: 'DELETE' }),
    accounts: {
      list: (poolId: string) =>
        fetchApi<ApiResponse<PoolAccount[]>>(`/api/traffic-pools/${poolId}/accounts`),
      add: (poolId: string, lineAccountId: string) =>
        fetchApi<ApiResponse<PoolAccount>>(`/api/traffic-pools/${poolId}/accounts`, {
          method: 'POST',
          body: JSON.stringify({ lineAccountId }),
        }),
      toggle: (poolId: string, accountId: string, isActive: boolean) =>
        fetchApi<ApiResponse<PoolAccount>>(
          `/api/traffic-pools/${poolId}/accounts/${accountId}`,
          {
            method: 'PUT',
            body: JSON.stringify({ isActive }),
          },
        ),
      remove: (poolId: string, accountId: string) =>
        fetchApi<ApiResponse<null>>(
          `/api/traffic-pools/${poolId}/accounts/${accountId}`,
          { method: 'DELETE' },
        ),
    },
  },
  affiliateOffers: {
    list: (params?: { activeOnly?: boolean }) => {
      const qs = params?.activeOnly ? '?activeOnly=true' : ''
      return fetchApi<{ success: boolean; data: AffiliateOffer[] }>(`/api/affiliate-offers${qs}`)
    },
    get: (id: string) =>
      fetchApi<{ success: boolean; data: AffiliateOffer }>(`/api/affiliate-offers/${id}`),
    create: (data: {
      name: string
      description?: string | null
      rewardAmount?: number
      rewardMiles?: number
      lineAccountId?: string | null
      tagId?: string | null
      scenarioId?: string | null
    }) =>
      fetchApi<{ success: boolean; data: AffiliateOffer }>('/api/affiliate-offers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<{
      name: string
      description: string | null
      rewardAmount: number
      rewardMiles: number
      lineAccountId: string | null
      tagId: string | null
      scenarioId: string | null
      isActive: boolean
    }>) =>
      fetchApi<{ success: boolean; data: AffiliateOffer }>(`/api/affiliate-offers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
  conversionApprovals: {
    list: (params?: { status?: 'pending' | 'approved' | 'rejected'; limit?: number; offset?: number }) => {
      const p = new URLSearchParams()
      if (params?.status) p.set('status', params.status)
      if (params?.limit !== undefined) p.set('limit', String(params.limit))
      if (params?.offset !== undefined) p.set('offset', String(params.offset))
      const qs = p.toString()
      return fetchApi<{ success: boolean; data: ConversionApprovalItem[] }>(
        `/api/conversions/approvals${qs ? `?${qs}` : ''}`,
      )
    },
    approve: (eventId: string) =>
      fetchApi<{ success: boolean; data?: { id: string; approvalStatus: string }; error?: string }>(
        `/api/conversions/events/${eventId}/approval`,
        { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) },
      ),
    reject: (eventId: string) =>
      fetchApi<{ success: boolean; data?: { id: string; approvalStatus: string }; error?: string }>(
        `/api/conversions/events/${eventId}/approval`,
        { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) },
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
  /** 広告連携（設計 V2 6-8）。鍵は伏せた形で返ってくる。 */
  adPlatforms: {
    list: () =>
      fetchApi<ApiResponse<AdPlatform[]>>('/api/ad-platforms'),
    logs: (id: string, limit = 20) =>
      fetchApi<ApiResponse<AdConversionLog[]>>(`/api/ad-platforms/${id}/logs?limit=${limit}`),
  },
  uploads: {
    /**
     * 既存 /api/images エンドポイントを叩いて画像をアップロードする。
     * 10MB 超 / image/* 以外は 400 で返る。
     */
    image: async (file: File): Promise<ApiResponse<{ id: string; key: string; url: string; mimeType: string; size: number }>> => {
      const buf = await file.arrayBuffer()
      return fetchApi<ApiResponse<{ id: string; key: string; url: string; mimeType: string; size: number }>>('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: buf,
      })
    },
  },
}

// ----------------------------------------------------------------
// Booking API client (admin endpoints scoped by ?account_id=)
// ----------------------------------------------------------------

export interface BookingMenu {
  id: string;
  name: string;
  category_label: string | null;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  base_price: number;
  sort_order: number;
  is_active: number;
  auto_tag_id: string | null;
  /** 同じ時間帯に受けられる件数。1 なら重ねない（従来どおり） */
  concurrent_capacity?: number;
  /** 何日先まで予約を受けるか。null なら制限なし */
  booking_window_days?: number | null;
  /** 開始の何時間前で締め切るか。null なら直前まで受ける */
  cutoff_hours_before?: number | null;
  /** 開始の何時間前までキャンセルできるか。null なら制限なし */
  cancel_deadline_hours_before?: number | null;
  /** 予約時にお客様へ聞く質問。null なら質問しない */
  intake_question?: string | null;
}

export interface BookingStaff {
  id: string;
  name: string;
  display_name: string;
  role: string | null;
  profile_image_url: string | null;
  bio: string | null;
  sort_order: number;
  is_designation_optional: number;
  is_active: number;
}

export interface BookingShift {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
}

export interface StaffMenuMatrix {
  menu_id: string;
  name: string;
  is_offered: number;
  override_duration_minutes: number | null;
  override_price: number | null;
}

export interface BookingRequest {
  id: string;
  friend_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  price_at_booking: number;
  menu_name: string;
  staff_name: string;
  friend_name: string | null;
  // 一覧 API は `SELECT b.*` なので bookings の全列が返る。詳細パネルで使う分だけ
  // 型に足す。internal_note / decided_by_staff_id は列こそあるが書き込み経路が
  // ないため、常に null になる。表示すると「いつまでも空欄」に見えるので出さない。
  requested_at: string;
  decided_at: string | null;
  external_event_id: string | null;
}

export interface BookingAvailabilityRule {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: number;
}

export interface BookingGoogleCalendarConnection {
  id: string;
  calendar_id: string;
  auth_type: string;
  is_active: number;
  last_verified_at: string | null;
  last_error: string | null;
}

function withAccount(path: string, accountId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}account_id=${encodeURIComponent(accountId)}`;
}

export const bookingApi = {
  // Menus
  listMenus: (accountId: string) =>
    fetchApi<{ menus: BookingMenu[] }>(withAccount('/api/booking/admin/menus', accountId)),
  createMenu: (accountId: string, body: Partial<BookingMenu>) =>
    fetchApi<{ id: string }>(withAccount('/api/booking/admin/menus', accountId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMenu: (accountId: string, id: string, body: Partial<BookingMenu>) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/menus/${id}`, accountId), {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteMenu: (accountId: string, id: string) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/menus/${id}`, accountId), {
      method: 'DELETE',
    }),
  // Staff
  listStaff: (accountId: string) =>
    fetchApi<{ staff: BookingStaff[] }>(withAccount('/api/booking/admin/staff', accountId)),
  createStaff: (accountId: string, body: Partial<BookingStaff>) =>
    fetchApi<{ id: string }>(withAccount('/api/booking/admin/staff', accountId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateStaff: (accountId: string, id: string, body: Partial<BookingStaff>) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/staff/${id}`, accountId), {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteStaff: (accountId: string, id: string) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/staff/${id}`, accountId), {
      method: 'DELETE',
    }),
  // staff_menus matrix
  getStaffMenus: (accountId: string, staffId: string) =>
    fetchApi<{ matrix: StaffMenuMatrix[] }>(
      withAccount(`/api/booking/admin/staff/${staffId}/menus`, accountId),
    ),
  putStaffMenus: (
    accountId: string,
    staffId: string,
    menus: Array<{
      menu_id: string;
      is_offered: boolean;
      override_duration_minutes?: number | null;
      override_price?: number | null;
    }>,
  ) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/booking/admin/staff/${staffId}/menus`, accountId),
      { method: 'PUT', body: JSON.stringify({ menus }) },
    ),
  // Shifts
  getShifts: (accountId: string, staffId: string) =>
    fetchApi<{ shifts: BookingShift[] }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts`, accountId),
    ),
  putShifts: (
    accountId: string,
    staffId: string,
    shifts: Array<{ work_date: string; start_time: string; end_time: string }>,
  ) =>
    fetchApi<{ ok: true; count: number }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts`, accountId),
      { method: 'PUT', body: JSON.stringify({ shifts }) },
    ),
  deleteShift: (accountId: string, staffId: string, shiftId: string) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts/${shiftId}`, accountId),
      { method: 'DELETE' },
    ),
  generateShifts: (
    accountId: string,
    staffId: string,
    body: {
      from_date: string;
      weeks: number;
      weekly_template: Record<string, { start: string; end: string } | null>;
    },
  ) =>
    fetchApi<{ inserted: number }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts/generate`, accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  getAvailabilityRules: (accountId: string, staffId: string) =>
    fetchApi<{ rules: BookingAvailabilityRule[] }>(
      withAccount(`/api/booking/admin/staff/${staffId}/availability-rules`, accountId),
    ),
  putAvailabilityRules: (
    accountId: string,
    staffId: string,
    rules: Array<{ weekday: number; start_time: string; end_time: string }>,
  ) =>
    fetchApi<{ ok: true; count: number }>(
      withAccount(`/api/booking/admin/staff/${staffId}/availability-rules`, accountId),
      { method: 'PUT', body: JSON.stringify({ rules }) },
    ),
  getGoogleCalendar: (accountId: string, staffId: string) =>
    fetchApi<{
      connection: BookingGoogleCalendarConnection | null;
      service_account: { configured: boolean; email: string | null };
    }>(withAccount(`/api/booking/admin/staff/${staffId}/google-calendar`, accountId)),
  putGoogleCalendar: (accountId: string, staffId: string, calendarId: string) =>
    fetchApi<{ ok: true; calendar_id: string; last_verified_at: string }>(
      withAccount(`/api/booking/admin/staff/${staffId}/google-calendar`, accountId),
      { method: 'PUT', body: JSON.stringify({ calendar_id: calendarId }) },
    ),
  deleteGoogleCalendar: (accountId: string, staffId: string) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/booking/admin/staff/${staffId}/google-calendar`, accountId),
      { method: 'DELETE' },
    ),
  // Requests
  listRequests: (accountId: string, status: string = 'requested') =>
    fetchApi<{ requests: BookingRequest[] }>(
      withAccount(`/api/booking/admin/requests?status=${status}`, accountId),
    ),
  decideRequest: (
    accountId: string,
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete',
  ) =>
    fetchApi<{ status: string }>(
      withAccount(`/api/booking/admin/requests/${id}`, accountId),
      { method: 'PATCH', body: JSON.stringify({ action }) },
    ),
  pendingCount: (accountId: string) =>
    fetchApi<{ count: number }>(withAccount('/api/booking/admin/pending-count', accountId)),
};

// ============================================================
// Event-booking admin API
// ============================================================

export interface EventListItem {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  next_slot_starts_at: string | null;
  total_capacity: number | null;
  total_active: number;
  pending_count: number;
  /** 申込条件。null なら友だち全員に見える（094） */
  visible_tag_id: string | null;
  /** visible_tag_id のタグ名。ID があっても消されたタグなら null */
  visible_tag_name: string | null;
  // Multi-account fields (migration 040)
  target_type?: 'single' | 'multi-account-dedup';
  account_ids?: string | string[] | null;
  line_account_id?: string;
}

export interface EventDetail {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  sort_order: number;
  confirmation_message_extra: string | null;
  reminder_message_extra: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  /** 公開対象を絞るタグ。null なら友だち全員に見える */
  visible_tag_id?: string | null;
  /** 満席のあとキャンセル待ちを受けるか。0 なら締め切る */
  waitlist_enabled?: number;
  /** 申込の締め切り（開始の何時間前まで）。null なら開始まで受ける */
  entry_cutoff_hours_before?: number | null;
  // Multi-account fields (migration 040, broadcasts と同パターン)
  target_type?: 'single' | 'multi-account-dedup';
  // Worker は JSON 文字列で返す。UI 側で parse して string[] を扱う。
  account_ids?: string | string[] | null;
  dedup_priority?: string | string[] | null;
  line_account_id?: string;
}

export interface EventSlot {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  active_count?: number;
}

export interface EventBookingItem {
  id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  line_account_id: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  requested_at: string;
  decided_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  slot_starts_at: string;
  slot_ends_at: string;
  friend_display_name: string | null;
  friend_line_user_id: string | null;
}

export interface EventWaitlistItem {
  id: string;
  slot_id: string;
  friend_id: string;
  /** waiting = 並んでいる / invited = 声をかけた */
  status: string;
  notified_at: string | null;
  created_at: string;
  slot_starts_at: string;
  friend_name: string | null;
}

export const eventsApi = {
  listEvents: (accountId: string) =>
    fetchApi<{ items: EventListItem[] }>(
      withAccount('/api/events/admin/events', accountId),
    ),
  getEvent: (accountId: string, id: string) =>
    fetchApi<EventDetail>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
    ),
  createEvent: (accountId: string, body: Partial<EventDetail>) =>
    fetchApi<EventDetail>(
      withAccount('/api/events/admin/events', accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  updateEvent: (accountId: string, id: string, body: Partial<EventDetail>) =>
    fetchApi<EventDetail>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  deleteEvent: (accountId: string, id: string) =>
    fetchApi<void>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
      { method: 'DELETE' },
    ),

  listSlots: (accountId: string, eventId: string) =>
    fetchApi<{ items: EventSlot[] }>(
      withAccount(`/api/events/admin/events/${eventId}/slots`, accountId),
    ),
  createSlots: (
    accountId: string,
    eventId: string,
    slots: Array<{ starts_at: string; ends_at: string; capacity: number | null; is_active?: number; sort_order?: number }>,
  ) =>
    fetchApi<{ items: EventSlot[] }>(
      withAccount(`/api/events/admin/events/${eventId}/slots`, accountId),
      { method: 'POST', body: JSON.stringify({ slots }) },
    ),
  updateSlot: (accountId: string, eventId: string, slotId: string, body: Partial<EventSlot>) =>
    fetchApi<EventSlot>(
      withAccount(`/api/events/admin/events/${eventId}/slots/${slotId}`, accountId),
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  deleteSlot: (accountId: string, eventId: string, slotId: string) =>
    fetchApi<void>(
      withAccount(`/api/events/admin/events/${eventId}/slots/${slotId}`, accountId),
      { method: 'DELETE' },
    ),

  /** キャンセル待ち。自動では繰り上げない。誰を通すかは運用の判断。 */
  listWaitlist: (accountId: string, eventId: string) =>
    fetchApi<{ waitlist: EventWaitlistItem[] }>(
      withAccount(`/api/events/admin/events/${eventId}/waitlist`, accountId),
    ),
  listBookings: (
    accountId: string,
    eventId: string,
    filters: { status?: string; slot_id?: string } = {},
  ) => {
    const qs: string[] = [];
    if (filters.status) qs.push(`status=${encodeURIComponent(filters.status)}`);
    if (filters.slot_id) qs.push(`slot_id=${encodeURIComponent(filters.slot_id)}`);
    const tail = qs.length > 0 ? `?${qs.join('&')}` : '';
    return fetchApi<{ items: EventBookingItem[] }>(
      withAccount(`/api/events/admin/events/${eventId}/bookings${tail}`, accountId),
    );
  },
  decideBooking: (
    accountId: string,
    eventId: string,
    bookingId: string,
    action: 'confirm' | 'reject',
    reason?: string,
  ) =>
    fetchApi<EventBookingItem>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}/decide`, accountId),
      { method: 'POST', body: JSON.stringify({ action, reason }) },
    ),
  adminCancelBooking: (accountId: string, eventId: string, bookingId: string) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}/cancel`, accountId),
      { method: 'POST' },
    ),
  updateBooking: (
    accountId: string,
    eventId: string,
    bookingId: string,
    body: { internal_note?: string | null; status?: 'attended' | 'no_show' },
  ) =>
    fetchApi<EventBookingItem>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}`, accountId),
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  pendingCount: (accountId: string) =>
    fetchApi<{ count: number }>(
      withAccount('/api/events/admin/events/notifications/pending', accountId),
    ),
};

// ===== Webinars =====

export type WebinarScheduleRule = {
  type: 'daily' | 'weekly' | 'once'
  time?: string
  days?: number[]
  at?: string
}

export type Webinar = {
  id: string
  accountId: string | null
  title: string
  slug: string
  status: 'draft' | 'active' | 'archived'
  videoPrefix: string | null
  durationSeconds: number
  schedule: WebinarScheduleRule[]
  cta: { label: string; url: string; showAtSeconds: number } | null
  tagOnAttend: string | null
  tagOnCtaClick: string | null
  createdAt: string
  updatedAt: string
}

export type WebinarInput = Partial<Omit<Webinar, 'id' | 'createdAt' | 'updatedAt'>>

export type WebinarSakuraComment = { id?: string; atSeconds: number; authorName: string; body: string }

export type WebinarAnalytics = {
  summary: {
    reservations: number
    viewers: number
    registeredAndJoined: number
    watched5m: number
    watched15m: number
    completed: number
    avgWatchedSeconds: number
    ctaClicks: number
    formSubmissions: number
  }
  daily: Array<{
    date: string
    reservations: number
    viewers: number
    ctaClicks: number
    formSubmissions: number
  }>
  participants: Array<{
    friendId: string
    friendName: string | null
    pictureUrl: string | null
    sessions: number
    firstJoinedAt: string
    latestJoinedAt: string
    maxWatchedSeconds: number
    ctaClickedAt: string | null
    registered: boolean
    formSubmittedAt: string | null
  }>
  sessions: Array<{ sessionStartAt: number; viewers: number; avgWatchedSeconds: number; ctaClicks: number }>
  dropoff: Array<{ bucketStart: number; viewers: number }>
  formFunnel: {
    ctaImpressions: number
    ctaClicks: number
    formOpens: number
    formStarts: number
    submitAttempts: number
    submitSuccesses: number
    submitErrors: number
    fieldCompletions: Array<{ fieldName: string; users: number }>
  }
}

export type WebinarUserComment = {
  id: string
  friendId: string
  friendName: string | null
  pictureUrl: string | null
  sessionStartAt: number
  atSeconds: number
  body: string
  createdAt: string
}

export type WebinarCtaCard = {
  id?: string
  atSeconds: number
  kind: 'form' | 'url'
  title: string
  body: string | null
  buttonLabel: string
  autoOpen: boolean
  formId: string | null
  url: string | null
}

export const webinarApi = {
  list: () => fetchApi<{ data: Webinar[] }>('/api/webinars'),
  get: (id: string) => fetchApi<{ data: Webinar }>(`/api/webinars/${id}`),
  create: (input: WebinarInput) =>
    fetchApi<{ data: Webinar }>('/api/webinars', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: WebinarInput) =>
    fetchApi<{ data: Webinar }>(`/api/webinars/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: string) => fetchApi<{ data: null }>(`/api/webinars/${id}`, { method: 'DELETE' }),
  comments: (id: string) =>
    fetchApi<{ data: WebinarSakuraComment[] }>(`/api/webinars/${id}/comments`),
  saveComments: (id: string, comments: WebinarSakuraComment[]) =>
    fetchApi<{ data: { count: number } }>(`/api/webinars/${id}/comments`, {
      method: 'PUT',
      body: JSON.stringify({ comments: comments.map(({ atSeconds, authorName, body }) => ({ atSeconds, authorName, body })) }),
    }),
  ctas: (id: string) => fetchApi<{ data: WebinarCtaCard[] }>(`/api/webinars/${id}/ctas`),
  saveCtas: (id: string, ctas: WebinarCtaCard[]) =>
    fetchApi<{ data: { count: number } }>(`/api/webinars/${id}/ctas`, {
      method: 'PUT',
      body: JSON.stringify({
        ctas: ctas.map(({ atSeconds, kind, title, body, buttonLabel, autoOpen, formId, url }) => ({
          atSeconds, kind, title, body, buttonLabel, autoOpen, formId, url,
        })),
      }),
    }),
  analytics: (id: string) => fetchApi<{ data: WebinarAnalytics }>(`/api/webinars/${id}/analytics`),
  userComments: (id: string) =>
    fetchApi<{ data: WebinarUserComment[] }>(`/api/webinars/${id}/user-comments`),
}
