import { adminSessionHeaders } from './admin-session'
import type { SegmentCondition } from './segment-condition'
import type {
  AutoReplyRunsResponse,
  AutoReplyConflict,
  AutoReplyDraftInput,
  AutoReplyDraftVersion,
  AutoReplyDryRunResult,
  AutoReplyPublishResult,
  AutoReplyValidationResult,
  Friend,
  FriendAddRouting,
  FriendAddRoutingDraftTestResult,
  FriendAddRoutingPublishResult,
  FriendAddRoutingValidation,
  FriendAddRoutingVersion,
  FriendAddEventList,
  FriendAddEventKind,
  FriendAddEventAttributionStatus,
  FriendAddEventRoutingStatus,
  Tag,
  TagGroup,
  TagCsvImportInputRow,
  TagCsvImportPreview,
  TagCsvImportResult,
  FriendField,
  FriendFieldListSummary,
  FriendFieldType,
  SupportMark,
  Folder,
  SavedSearch,
  SavedSegmentPreset,
  SavedSegmentConditions,
  MediaItem,
  MediaUsage,
  MediaDeleteImpact,
  MediaReplacementImpact,
  MediaReplacementResult,
  CommonVar,
  CommonVarDeleteImpact,
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
  WebhookInteraction,
  WebhookInteractionDirection,
  WebhookInteractionList,
  NotificationRule,
  Notification,
  NotificationCenterData,
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
  FormLayout,
  MergedPersonDetail,
  UpdateMergedPersonRequest,
  UpdateMergedPersonDeliveryPrioritiesRequest,
  FriendBulkSelection,
  FriendBulkOperation,
  FriendBulkPreview,
  FriendBulkRunSummary,
  FriendBulkRunDetail,
  IdentityCandidateDetail,
  IdentityCandidateKind,
  IdentityCandidateList,
  IdentityCandidateStatus,
  DetectIdentityCandidatesResult,
  DecideIdentityCandidateRequest,
  UndoIdentityCandidateRequest,
} from '@line-crm/shared'

/**
 * タグを消したときに失われるもの（`GET /api/tags/:id/delete-impact`）。
 *
 * 実体は `packages/db` の `TagDeleteImpact`。web からは `packages/db` を
 * 読めないので、ここに写している。**増減したら両方直す。**
 */
export type TagDeleteImpactReferences = {
  broadcasts: number
  forms: number
  scenarios: number
  autoReplies: number
  savedSearches: number
  automations: number
  commonActions: number
  richMenus: number
  templates: number
  webinars: number
  reminders: number
  entryRoutes: number
  trackedLinks: number
  bookingMenus: number
  affiliateOffers: number
  events: number
  analyticsFunnels: number
  friendAddSettings: number
}

export type TagDeleteImpact = {
  tag: { id: string; name: string }
  /** タグを外される友だちの人数。**これだけでは削除を止めない。** */
  friendCount: number
  /** このタグIDをいまも保存している運用設定の件数。 */
  references: TagDeleteImpactReferences
  blockingReferenceCount: number
  canDelete: boolean
}

/*
 * 緊急停止の「止める前に何が止まるか」。
 *
 * ここに置いてあるのは**影響を見るぶんだけ**。止める・戻す口は
 * 段階的な本人確認のヘッダを送るが、worker 側の許可一覧にまだ無い
 * （`apps/worker/src/cors-headers.test.ts` が落ちる）。口が入ってから足す。
 */
export type OperationCapability =
  | 'broadcast_dispatch'
  | 'scenario_dispatch'
  | 'reminder_dispatch'
  | 'automation_actions'
  | 'auto_reply_dispatch'
  | 'webhook_outgoing'
  | 'ad_postback'

export type OperationImpactMetric = {
  itemCount: number
  /** 数える経路が無いときは null。**0人と読み替えない。** */
  friendCount: number | null
  pendingCount?: number
  nearestScheduledAt?: string | null
}

export type OperationImpactPreview = Record<
  Extract<OperationCapability,
    | 'broadcast_dispatch'
    | 'scenario_dispatch'
    | 'reminder_dispatch'
    | 'automation_actions'
    | 'auto_reply_dispatch'>,
  OperationImpactMetric
>

export type OperationControl = {
  scopeKey: string
  lineAccountId: string | null
  version: number
  states: Record<OperationCapability, 'running' | 'stopped'>
  activeIncidentId: string | null
  reason: string | null
  actorId: string | null
  stoppedAt: string | null
  updatedAt: string | null
}

export type FormDeleteImpact = {
  form: {
    id: string
    name: string
    isActive: boolean
    status: 'active' | 'archived'
  }
  submissionCount: number
  openCount: number
  references: Array<{
    kind: 'webinar' | 'rich_menu'
    name: string | null
    href: string | null
    state: 'available' | 'unavailable'
  }>
  referenceCount: number
  answerUrl: string | null
  revision: number
  checkedAt: string
  canDelete: boolean
  canArchive: boolean
  recommendedAction: 'delete' | 'archive' | 'none'
  blockers: Array<'published' | 'has_submissions' | 'has_opens' | 'in_use' | 'already_archived'>
}

/**
 * リッチメニューを消したときの影響（`GET /api/rich-menu-groups/:id/delete-impact`）。
 *
 * LINEは友だちごとの現在表示を返さないため、currentAudience.value は取得できる
 * 口ができるまで null。0人と読み替えてはいけない。
 */
export type RichMenuDeleteImpact = {
  group: {
    id: string
    accountId: string
    name: string
    status: 'draft' | 'published'
  }
  currentAudience: {
    value: number | null
    reason: 'assignment_ledger_unavailable'
  }
  nextDisplay: {
    guaranteedGroupId: null
    reason: 'friend_specific_rules'
    candidates: Array<{
      groupId: string
      name: string
      targetingPriority: number
      isTargetingEnabled: boolean
      isDefaultForAll: boolean
    }>
  }
  incomingSwitches: Array<{
    sourceGroupId: string
    sourceGroupName: string
    sourcePageId: string
    sourcePageName: string
    areaId: string
    areaLabel: string | null
    targetPageId: string
    targetPageName: string
  }>
  operationalReferences: Array<{
    kind: 'automation' | 'common_action'
    ownerId: string
    ownerName: string
  }>
  lineResources: {
    pageCount: number
    pagesWithLineRichMenuId: number
    isDefaultForAll: boolean
    publishing: boolean
  }
  blockers: Array<
    | 'published'
    | 'publishing'
    | 'default_for_all'
    | 'line_resources'
    | 'incoming_switches'
    | 'operational_references'
  >
  canDelete: boolean
  recommendedAction: 'delete' | 'unpublish' | 'review_references'
}

/**
 * 対応マークの自動変更ルール（設計 `GMvBd` 4-3-A）。
 *
 * きっかけは5つ。**Worker の `SUPPORT_MARK_RULE_EVENTS` と同じ並び**で持つ。
 * 画面側で足すと、選べるのに保存できない選択肢ができる。
 */
export type SupportMarkAutomationEvent =
  | 'message_received'
  | 'manual_reply_sent'
  | 'staff_assigned'
  | 'response_overdue'
  | 'condition_matched'

export type SupportMarkAutomationRule = {
  id: string
  name: string
  markId: string
  event: SupportMarkAutomationEvent
  condition: SegmentCondition | null
  priority: number
  /** 手で変えたマークを守る時間（分）。**0は「保護しない」で、未取得ではない。** */
  manualProtectionMinutes: number
  isActive: boolean
  /** 取り合いを見つけるための版。読んだ版と違えば 409。 */
  version: number
  updatedAt: string
}

export type SaveSupportMarkAutomationRule = Omit<
  SupportMarkAutomationRule,
  'id' | 'markId' | 'version' | 'updatedAt'
>

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

/** 支払台帳を作る前に安全に表示できる、承認済み報酬の読み取り専用集計。 */
export type AffiliatePaymentSummary = {
  affiliateId: string
  affiliateName: string
  code: string
  holdDays: number | null
  payoutCycle: string | null
  approvedConversions: number
  approvedReward: number
  heldConversions: number
  heldReward: number
  holdStatusUnknown: number
}

/** Broadcast type from API (now camelCase after worker serialization) */
export type ApiBroadcast = Omit<Broadcast, 'targetType'> & {
  targetType: BroadcastTargetType;
  /** Worker が返す配信元LINEアカウント。旧データは null。 */
  lineAccountId: string | null;
  accountIds: string[] | null;
  dedupPriority: string[] | null;
  failedAccountIds: string[] | null;
  trackLinks: boolean;
  messageBubbles?: BroadcastBubble[] | null;
  /** 宛先の条件。一覧で「何で絞ったか」を出すのに使う。 */
  segmentConditions?: SegmentCondition | null;
  /** 分類。null なら未分類。 */
  folderId?: string | null;
  /** 開封数を取るか。 */
  measureOpens?: boolean;
};

export type BroadcastBubbleType = 'text' | 'sticker' | 'image' | 'flex' | 'location' | 'audio' | 'carousel' | 'rich_message' | 'rich_video' | 'video' | 'card_message' | 'coupon' | 'research';
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

export type CommonActionStep = {
  id: string;
  type: 'add_tag' | 'remove_tag' | 'set_metadata' | 'start_scenario' | 'stop_scenario'
    | 'resume_scenario' | 'send_message' | 'send_webhook' | 'switch_rich_menu'
    | 'remove_rich_menu' | 'wait' | 'common_action';
  params: Record<string, unknown>;
  onFailure: 'stop' | 'continue';
};

export type CommonActionSummary = {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  draftVersion: number | null;
  publishedVersion: number | null;
  actionCount: number;
  bindingCount: number;
  oldVersionBindingCount: number;
  updatedAt: string;
};

export type AnalyticsMetricState =
  | 'available'
  | 'pending'
  | 'unavailable'
  | 'insufficient'
  | 'partial'
  | 'failed'

export type AnalyticsMetric<T> = {
  value: T | null
  state: AnalyticsMetricState
  reason: string | null
}

export type AnalyticsEnvelope<T> = {
  lineAccountId: string
  timeZone: string
  period: { from: string; to: string }
  dataCutoffAt: string
  data: T
}

export type AnalyticsFriendsOverview = AnalyticsEnvelope<{
  state: AnalyticsMetricState
  stateReason: string | null
  metrics: {
    added: AnalyticsMetric<number>
    removed: AnalyticsMetric<number>
    net: AnalyticsMetric<number>
    currentFriends: AnalyticsMetric<number>
    firstTime: AnalyticsMetric<number>
    returning: AnalyticsMetric<number>
  }
  days: Array<{ date: string; added: number; removed: number; net: number }>
  campaigns: Array<{
    id: string
    name: string
    kind: 'broadcast' | 'scenario'
    occurredAt: string
    date: string
  }>
  historyAvailableFrom: string | null
}>

export type AnalyticsReactionsOverview = AnalyticsEnvelope<{
  metrics: {
    sent: AnalyticsMetric<number>
    delivered: AnalyticsMetric<number>
    opened: AnalyticsMetric<number>
    lineClicked: AnalyticsMetric<number>
    trackedClicks: AnalyticsMetric<number>
    unavailableCampaigns: AnalyticsMetric<number>
  }
  campaigns: Array<{
    id: string
    name: string
    kind: 'broadcast' | 'scenario'
    sentAt: string
    targetPeople: AnalyticsMetric<number>
    delivered: AnalyticsMetric<number>
    opened: AnalyticsMetric<number>
    lineClicked: AnalyticsMetric<number>
    outcomes: AnalyticsMetric<number>
    fetchedAt: string | null
  }>
  trackedClickHours: Array<{ hour: number; clicks: number }>
  clickDefinition: string
}>

export type AnalyticsRoutesOverview = AnalyticsEnvelope<{
  attributionModel: 'first_touch'
  attributionLabel: string
  routes: Array<{
    id: string
    refCode: string | null
    name: string
    clicks: AnalyticsMetric<number>
    friendAdds: AnalyticsMetric<number>
    currentFriends: AnalyticsMetric<number>
    reactionPeople: AnalyticsMetric<number>
    conversions: {
      approved: AnalyticsMetric<number>
      pending: AnalyticsMetric<number>
      rejected: AnalyticsMetric<number>
      revenue: AnalyticsMetric<number>
    }
    adCost: AnalyticsMetric<number>
    costPerFriend: AnalyticsMetric<number>
    costPerConversion: AnalyticsMetric<number>
    profitAfterAdCost: AnalyticsMetric<number>
  }>
  searchConsoleHref: string
}>

export type AnalyticsUsageOverview = AnalyticsEnvelope<{
  state: AnalyticsMetricState
  stateReason: string | null
  checkedAt: string
  automaticDeletion: false
  summary: {
    unusedItems: AnalyticsMetric<number>
    automaticRuns: AnalyticsMetric<number>
    manualSends: AnalyticsMetric<number>
    estimatedHoursSaved: AnalyticsMetric<number>
  }
  categories: Array<{
    key: string
    label: string
    href: string
    created: AnalyticsMetric<number>
    inUse: AnalyticsMetric<number>
    unused: AnalyticsMetric<number>
    brokenReferences: AnalyticsMetric<number>
    lastUsedAt: AnalyticsMetric<string>
  }>
}>

export type AnalyticsUrlClicksOverview = AnalyticsEnvelope<{
  state: AnalyticsMetricState
  stateReason: string | null
  exposureAvailableFrom: string | null
  hasMore: boolean
  clickRateDefinition: string
  links: Array<{
    trackedLinkId: string
    name: string
    originalUrl: string
    shortCode: string | null
    isActive: boolean
    actions: { tagName: string | null; scenarioName: string | null }
    clicks: AnalyticsMetric<number>
    knownClickPeople: AnalyticsMetric<number>
    deliveredPeople: AnalyticsMetric<number>
    clickRate: AnalyticsMetric<number>
    firstClickedAt: AnalyticsMetric<string>
    lastClickedAt: AnalyticsMetric<string>
    usageLocations: string[]
  }>
}>

export type AnalyticsCrossAxis =
  | { kind: 'route' }
  | { kind: 'tag' }
  | { kind: 'field_choice'; fieldId: string }
  | { kind: 'score_band' }
  | { kind: 'conversion_point' }
  | { kind: 'booking_status' }
  | { kind: 'purchase_status' }

export type AnalyticsCrossResult = {
  lineAccountId: string
  timeZone: string
  rowValues: Array<{ key: string; label: string }>
  columnValues: Array<{ key: string; label: string }>
  cells: Array<{
    rowKey: string
    rowLabel: string
    columnKey: string
    columnLabel: string
    value: number
    uniqueFriends: number
    totalRatio: number | null
    previousValue: number
    difference: number
  }>
  totalValue: number
  totalFriends: number
  previousTotalValue: number
  periodFrom: string
  periodTo: string
  previousPeriodFrom: string
  previousPeriodTo: string
  dataCutoffAt: string
  state: 'available' | 'partial' | 'unavailable'
  stateReason: string | null
}

export type AnalyticsFunnelStepResult = {
  stepOrder: number
  label: string
  reached: number
  conversionFromPrevious: number | null
  droppedAfter: number
  inProgressAfter: number
  averageSecondsFromPrevious: number | null
  medianSecondsFromPrevious: number | null
}

export type AnalyticsFunnelRunResult = {
  runId: string | null
  funnelId: string
  versionId: string | null
  versionNumber: number | null
  lineAccountId: string
  cohortFrom: string
  cohortTo: string
  timeZone: string
  dataCutoffAt: string
  state: 'available' | 'unavailable' | 'partial' | 'failed'
  stateReason: string | null
  groups: Array<{
    key: string
    label: string
    entrants: number
    completed: number
    steps: AnalyticsFunnelStepResult[]
  }>
}

export type SavedAnalyticsSummary = {
  id: string
  name: string
  kind: 'cross' | 'funnel'
  status: 'active' | 'archived'
  currentVersionNumber: number
  createdBy: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
  snapshotCount: number
  latestSnapshot: {
    id: string
    state: 'available' | 'partial' | 'unavailable' | 'failed'
    periodFrom: string
    periodTo: string
    dataCutoffAt: string
    createdAt: string
  } | null
}

export type SavedAnalyticsSnapshot = {
  id: string
  savedAnalysisId: string
  analysisVersionId: string
  sourceKind: 'cross' | 'funnel'
  sourceResultId: string
  periodFrom: string
  periodTo: string
  timeZone: string
  dataCutoffAt: string
  state: 'available' | 'partial' | 'unavailable' | 'failed'
  result: unknown
  createdBy: string | null
  createdAt: string
}

export type CommonActionVersion = {
  id: string;
  versionNumber: number;
  status: 'draft' | 'published';
  actions: CommonActionStep[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type CommonActionBinding = {
  id: string;
  consumerType: string;
  consumerId: string;
  consumerPath: string;
  versionId: string;
  versionNumber: number;
  latestVersionNumber: number | null;
  hasNewerVersion: boolean;
  runningCount: number | null;
  waitingCount: number | null;
  updatedAt: string;
};

export type CommonActionDetail = {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  currentDraftVersionId: string | null;
  currentPublishedVersionId: string | null;
  versions: CommonActionVersion[];
  bindings: CommonActionBinding[];
};

export type CommonActionResources = {
  tags: Array<{ id: string; name: string }>;
  scenarios: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string }>;
  webhooks: Array<{ id: string; name: string }>;
  richMenus: Array<{ id: string; name: string }>;
  commonActions: Array<{ id: string; name: string; version: number }>;
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

/**
 * セッションがサーバーに届かなかったときに投げる合図。
 *
 * 401 のたびに出る。受け手（SessionLostNotice）が、ログインの跡が
 * 残っているかどうかを見て、案内を出すか、ただの未ログインとして
 * 見送るかを決める。
 */
export const SESSION_LOST_EVENT = 'lh-session-lost'

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
  readonly code: string | undefined
  /** 409などで画面を最新状態へ描き直すための機械データ。利用者へ直接表示しない。 */
  readonly data: unknown

  constructor(status: number, message?: string, code?: string, data?: unknown) {
    super(message || `API error: ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data
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

/**
 * 画面分岐にだけ使う、Worker由来の機械コードを取り出す。
 *
 * 本文を利用者へ表示してよいかとは別の契約。英小文字と数字のsnake_caseだけに
 * 絞り、SQL・外部API・HTMLなどの内部文言はコードとしても受け取らない。
 */
export function extractApiErrorCode(raw: string): string | undefined {
  if (!raw) return undefined
  try {
    const body = JSON.parse(raw) as { code?: unknown; error?: unknown }
    const candidate = typeof body.code === 'string' ? body.code : body.error
    if (typeof candidate === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(candidate)) {
      return candidate
    }
  } catch {
    // JSONでなければ機械コードも無い。
  }
  return undefined
}

/** エラー本文の `data` だけを機械処理用に保持する。本文の文言は表示契約と分ける。 */
export function extractApiErrorData(raw: string): unknown {
  if (!raw) return undefined
  try {
    const body = JSON.parse(raw) as { data?: unknown }
    return body && typeof body === 'object' ? body.data : undefined
  } catch {
    return undefined
  }
}

function reportServerFailure(path: string, status: number): void {
  if (typeof window === 'undefined' || path === '/api/client-errors') return
  const token = getCsrfToken()
  void (async () => {
    try {
      await fetch(`${API_URL}/api/client-errors`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...adminSessionHeaders(),
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: JSON.stringify({
          message: `API ${status}: ${path}`,
          path: `${window.location.origin}${window.location.pathname}`,
          occurredAt: new Date().toISOString(),
        }),
      })
    } catch {
      // Slack報告自体の失敗で、元のAPIエラー処理を壊さない。
    }
  })()
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
  /*
   * 401 は「セッションがサーバーに届いていない」。
   *
   * 管理画面とAPIは別サイトなので、ブラウザがサイトをまたぐCookieを
   * 止めると全部のAPIがこれになる。各画面がそれぞれ「エラー」と出すだけ
   * だと、全画面が同時に壊れているのに理由がどこにも出ない。
   * 1か所で受けられるように知らせる（受け手は SessionLostNotice）。
   */
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_LOST_EVENT))
  }
  if (res.status >= 500) reportServerFailure(path, res.status)
  if (!res.ok) {
    const raw = await res.text()
    throw new ApiError(
      res.status,
      extractApiErrorMessage(raw, res.status),
      extractApiErrorCode(raw),
      // 最新状態は409のときだけ保持する。500等の内部データは画面へ渡さない。
      res.status === 409 ? extractApiErrorData(raw) : undefined,
    )
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type FriendListParams = {
  offset?: string
  limit?: string | number
  tagId?: string
  accountId?: string
  /** 分析結果から作った24時間の対象者。友だちIDをURLへ並べない。 */
  audienceId?: string
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
  /** 最新の対応担当者。 */
  operatorId?: string
  /** 現在配信中のシナリオ。 */
  scenarioId?: string
  /** サーバーへ保存したAND/OR条件。選択中のLINEアカウントが必須。 */
  savedSearchId?: string

  // ── 詳細検索（設計 V2 2-2 の「絞り込み条件を設定」）─────────────────
  // どれも足し算。指定が無ければ何も起きない。

  /** タグ。**すべて満たす**（AND）。 */
  tagIds?: string[]
  /** このタグが付いていない人。 */
  excludeTagIds?: string[]
  /** 友だち情報が等しい。`{ 項目名: 値 }` */
  metadata?: Record<string, string>
  /** 友だち情報が等しくない。値を持たない人も含む。 */
  metadataNot?: Record<string, string>
  /** ステータスメッセージに含む。 */
  statusMessage?: string
  /** 友だち登録日（YYYY-MM-DD）。 */
  createdFrom?: string
  createdTo?: string
  /** 対応マーク。 */
  chatStatus?: 'unread' | 'in_progress' | 'on_hold' | 'resolved'
  /** 表示設定。未指定は全部。 */
  visibility?: 'following' | 'blocked'
  /** 行動スコアの現在値。片方だけでも指定できる。 */
  scoreMin?: number
  scoreMax?: number
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
    status: 'unread' | 'in_progress' | 'on_hold' | 'resolved'
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
  sourceReferenceId: string | null
  ruleName: string | null
  mode: 'automatic' | 'manual'
  executedByStaffName: string | null
  occurredAt: string
}
export type MileageSelfInsights = {
  accountCount: number
  rewardedActions: number
  referralMiles: number
  qualityReferralCount: number
  lastEarnedAt: string | null
}
export type MileageConnectedAccount = {
  accountId: string
  accountName: string
  friendId: string
}
export type MileageAdjustmentPolicy = {
  configured: boolean
  approvalThreshold: number | null
}
export type MileageAdjustmentResult = {
  entryId: string
  balanceBefore: number
  amount: number
  balanceAfter: number
  replayed: boolean
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
export type MileageAdminHistoryItem = {
  id: string
  primaryFriendId: string
  displayName: string
  pictureUrl: string | null
  entryType: MileageHistoryItem['entryType']
  status: MileageHistoryItem['status']
  amount: number
  reason: string
  source: string
  hasSourceEvent: boolean
  sourceReferenceId: string | null
  ruleName: string | null
  mode: 'automatic' | 'manual'
  executedByStaffName: string | null
  occurredAt: string
}
export type MileageAdminHistory = {
  items: MileageAdminHistoryItem[]
  pagination: { total: number; limit: number; offset: number }
}
export type AutomationTemplateSummary = {
  key: string
  name: string
  description: string
  triggerLabel: string
  actionLabel: string
}
export type AutomationDraftAction = {
  id: string
  type: 'add_tag' | 'start_scenario' | 'send_message'
  params: Record<string, unknown>
  onFailure: 'stop'
}
export type AutomationDraftDetail = {
  id: string
  draftVersionId: string
  name: string
  description: string | null
  eventType: 'friend_add' | 'tag_change' | 'message_received'
  triggerConfig: Record<string, unknown>
  conditions: Record<string, unknown>
  actions: AutomationDraftAction[]
}
export type ActionScoreBand = 'high' | 'normal' | 'low'
export type ActionScoreFilter = 'all' | ActionScoreBand | 'decreased'
export type ActionScoreSort = 'score_desc' | 'score_asc' | 'change_desc' | 'change_asc' | 'recent_desc'
export type ActionScoreOverview = {
  summary: {
    scoredFriends: number
    high: number
    normal: number
    low: number
    decreased30d: number
    highMin: number
    normalMin: number
  }
  items: Array<{
    friendId: string
    displayName: string
    pictureUrl: string | null
    currentScore: number
    band: ActionScoreBand
    change30d: number
    lastReason: string | null
    lastChangedAt: string | null
  }>
  pagination: { total: number; limit: number; offset: number }
}
export type ActionScoreRuleOperation = 'delta' | 'set'
export type ActionScoreFrequencyKind =
  | 'unlimited'
  | 'per_day'
  | 'per_subject'
  | 'per_subject_per_day'
  | 'once_per_period'
export type ActionScoreRule = {
  id: string
  name: string
  eventType: string
  source: string | null
  operation: ActionScoreRuleOperation
  value: number
  frequency: { kind: ActionScoreFrequencyKind; limit: number }
  sameSourceEventOnce: true
  validFrom: string | null
  validUntil: string | null
  enabled: boolean
}
export type ActionScoreBands = {
  min: number
  max: number
  normalMin: number
  highMin: number
}
export type ActionScoreRuleBundle = { rules: ActionScoreRule[]; bands: ActionScoreBands }
export type ActionScoreRuleVersion = ActionScoreRuleBundle & {
  id: string | null
  versionNumber: number
  status: 'draft' | 'published'
  createdAt: string | null
  publishedAt: string | null
}
export type ActionScoreRuleConfiguration = {
  configured: boolean
  status: 'not_configured' | 'draft' | 'published' | 'stopped'
  currentDraftVersionId: string | null
  currentPublishedVersionId: string | null
  editableVersion: ActionScoreRuleVersion
  publishedVersion: ActionScoreRuleVersion | null
}
export type ActionScoreRuleTestResult = {
  scoreBefore: number
  scoreAfter: number
  bandBefore: ActionScoreBand
  bandAfter: ActionScoreBand
  matched: Array<{ ruleId: string; ruleName: string; scoreBefore: number; scoreAfter: number }>
}
/** Friend list items, optionally hydrated with chat status (when ?includeChatStatus=true) */
export type FriendListItem = FriendWithTags & Partial<{
  latestIncomingMessage: { content: string; messageType: string; createdAt: string } | null
  latestOutgoingAt: string | null
  activeScenario: { name: string; status: string } | null
  handled: boolean
  operator: { id: string; name: string } | null
  supportMark: { id: string; name: string; color: string } | null
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

/** 質問テンプレート。シナリオの質問と同じ契約を使う。 */
export type TemplateQuestion = {
  intro?: string
  text: string
  altText?: string
  tapMode: 'single' | 'multiple'
  choices: Array<{
    label: string
    behavior: 'none' | 'url' | 'tel' | 'add_friend' | 'mail' | 'form' | 'scenario'
    url?: string
    tel?: string
    email?: string
    formId?: string
    scenario?: { op: 'start' | 'stop'; scenarioId?: string | null; restart?: 'from_start' | 'from_read'; rememberPrevious?: boolean }
    userMessage?: string
    hideUserMessage?: boolean
    reply?: string
    repeatReply?: string
    addTagIds?: string[]
    removeTagIds?: string[]
    field?: { fieldId: string; value: string }
  }>
}

/* ---- リッチメニューのボタン（147） ---- */

/**
 * ボタンが「何をするか」。
 *
 * LINE が持てる動きは uri / message / postback / richmenuswitch の4つだけ。
 * 「電話をかける」「テンプレートを送る」「回答フォームを開く」はその上に乗せた
 * 言い換えで、LINE に登録するときに4つのどれかへ変換される。
 */
export type RichMenuAreaIntent =
  | 'url'
  | 'tel'
  | 'text'
  | 'template'
  | 'form'
  | 'switch'
  | 'postback'

/** 押された回数（148）。 */
export type RichMenuAreaTapCount = {
  areaId: string
  groupId: string
  pageId: string
  /** ボタン名。消されたボタンは、押された時点の名前が出る。 */
  label: string | null
  taps: number
  /** そのうち、計測リンク経由で数えた分。 */
  viaTrackedLink: number
}

export type RichMenuTapStats = {
  from: string
  to: string
  byArea: RichMenuAreaTapCount[]
  byGroup: { groupId: string; taps: number }[]
  total: number
}

/** 保存するときに送るボタン1つぶん。 */
export type RichMenuAreaPayload = {
  /** 既存ボタンの id。渡すと引き継がれる（押された回数の集計が途切れない）。 */
  id?: string
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
  actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch'
  actionData: Record<string, unknown>
  intent?: RichMenuAreaIntent | null
  /** 管理用のボタン名。 */
  label?: string | null
  /** 押されたときに付けるタグ。 */
  tagIds?: string[] | null
  /** 押されたときに足すスコア。 */
  scoreChange?: number | null
  templateId?: string | null
  formId?: string | null
  trackedLinkId?: string | null
}

/** 読み出したときのボタン1つぶん。 */
export type RichMenuAreaResponse = {
  id: string
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
  actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch'
  actionData: Record<string, unknown>
  intent: RichMenuAreaIntent | null
  label: string | null
  tagIds: string[]
  scoreChange: number | null
  templateId: string | null
  formId: string | null
  trackedLinkId: string | null
}

/** シナリオの開始のきっかけ（128）。1本に複数持てる。 */
export type ScenarioTriggerItem = {
  id: string
  /** friend_add … 友だち追加時 / tag_added … 決めたタグが付いたとき */
  kind: 'friend_add' | 'tag_added'
  /** kind が tag_added のときだけ入る。 */
  tagId: string | null
}

/* ---- シナリオのアクション（Lステップの「アクション設定」にあたる） ---- */

/** どこで発火するか。 */
export type ScenarioActionHook = 'step_sent' | 'scenario_completed' | 'choice_selected'

/** 何をするか。 */
export type ScenarioActionType =
  | 'tag'
  | 'friend_field'
  | 'support_mark'
  | 'scenario'
  | 'common_var'

export type ScenarioAction = {
  id: string
  scenarioId: string
  hook: ScenarioActionHook
  stepId: string | null
  choiceIndex: number | null
  sortOrder: number
  actionType: ScenarioActionType
  /** 種別ごとに形が違う。worker の services/scenario-actions.ts に定義がある。 */
  config: unknown
  /** 実行条件。null なら無条件。 */
  condition: unknown
  /** false なら、同じ友だちには1度しか実行しない。 */
  repeatOnRefire: boolean
  /**
   * 中身が埋まっているか。false のあいだは配信で実行されない。
   * 画面はカードを1枚置いてから埋める作りなので、途中の状態がありうる。
   */
  complete?: boolean
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
  /** 返信を待っている会話のうち、最も長い待ち時間（分）。 */
  oldestWaitingMinutes: number | null
  /** 受信から初回返信までの平均（分）。記録が無ければ null。 */
  averageFirstReplyMinutes: number | null
  /** そのうち1時間以上待たせているもの。 */
  waitingOverAnHour: number
  mine: number
  todayInbound: number
  todayByChannel: { line: number; email: number }
  /** 担当未設定は operatorId/operatorName が null。0件の担当者は配列に含まれない。 */
  assigneeUnread: Array<{
    operatorId: string | null
    operatorName: string | null
    unread: number
  }>
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
    /** 段階配備中の旧Workerでは未返却。 */
    sources?: Array<{ name: string; count: number }>
  }>
  conversions: {
    total: number
    byPoint: Array<{ name: string; count: number }>
  }
  /** 取得に失敗して0へ見せていない項目。段階配備中の旧Workerでは未返却。 */
  partialFailures?: string[]
  /** 段階配備中の旧Workerでは未返却。 */
  operations?: {
    scenarios: { active: number; paused: number }
    migrations: { active: number; completed: number }
    bookings: { pending: number; upcoming: number }
    inflowTop: Array<{ name: string; count: number }>
    funnelAlerts: number
    automationFailures: number
  }
  sections?: Record<
    'friends' | 'inbox' | 'delivery' | 'quota' | 'trend' | 'conversions' | 'operations',
    {
      status: 'ok' | 'empty' | 'unavailable' | 'stale' | 'estimated'
      asOf: string
      period: 'today' | 'last7' | 'last28' | 'latest' | 'last7-fixed' | 'this-month'
    }
  >
}

export type DashboardPreferenceResponse = {
  source: 'personal' | 'account-default' | 'builtin'
  version: number
  cards: unknown
  updatedAt: string | null
}

export type EcCommerceOverview = {
  total: number
  processed: number
  identityPending: number
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
  status: 'received' | 'identity_pending' | 'processing' | 'processed' | 'skipped' | 'failed'
  errorMessage: string | null
  receivedAt: string
  processedAt: string | null
}

export type EcNotificationRun = {
  id: string
  recipientType: 'customer'
  notificationName: string
  source: 'EC連携'
  sourceEventId: string
  friendId: string
  friendName: string | null
  orderNumber: string | null
  channel: 'line'
  status: 'pending' | 'accepted' | 'excluded' | 'failed'
  reason: string | null
  receivedAt: string
  acceptedAt: string | null
  attemptCount: number | null
  nextRetryAt: string | null
  clickedAt: string | null
  version: number | null
  executionMode: 'automatic'
  retryAvailable: false
}

export type EcNotificationRunList = {
  items: EcNotificationRun[]
  summary: { accepted: number; failed: number; excluded: number; pending: number }
  coverage: {
    source: 'current_ec_events'
    unassignedHistoricalRowsExcluded: true
    attemptHistoryAvailable: false
    retryAvailable: false
  }
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
  quantity: number
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
  category: 'order' | 'payment' | 'shipping' | 'support' | 'subscription'
  buttonLabel: string
  buttonUrl: string
  imageUrl: string
  displayOrder: number
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

export type NenColumnCreateInput = {
  title: string
  category?: string
  excerpt?: string
  articleUrl: string
  imageUrl?: string | null
  /** タイムゾーン付きISO 8601。未公開の下書きはnullまたは省略。 */
  publishedAt?: string | null
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
function rangeQuery(params?: { from?: string; to?: string; accountId?: string }): string {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.accountId) q.set('account_id', params.accountId)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const api = {
  system: {
    health: () =>
      fetchApi<ApiResponse<{ status: 'ok' }>>('/api/health'),
  },
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
      if (params?.audienceId) query.audienceId = params.audienceId
      if (params?.search) query.search = params.search
      if (params?.includeTags === false) query.includeTags = 'false'
      if (params?.includeChatStatus) query.includeChatStatus = 'true'
      if (params?.sort) query.sort = params.sort
      if (params?.handled) query.handled = params.handled
      if (params?.operatorId) query.operatorId = params.operatorId
      if (params?.scenarioId) query.scenarioId = params.scenarioId
      if (params?.savedSearchId) query.savedSearchId = params.savedSearchId
      if (params?.tagIds?.length) query.tagIds = params.tagIds.join(',')
      if (params?.excludeTagIds?.length) query.excludeTagIds = params.excludeTagIds.join(',')
      if (params?.statusMessage) query.statusMessage = params.statusMessage
      if (params?.createdFrom) query.createdFrom = params.createdFrom
      if (params?.createdTo) query.createdTo = params.createdTo
      if (params?.chatStatus) query.chatStatus = params.chatStatus
      if (params?.visibility) query.visibility = params.visibility
      if (params?.scoreMin !== undefined) query.scoreMin = String(params.scoreMin)
      if (params?.scoreMax !== undefined) query.scoreMax = String(params.scoreMax)
      for (const [k, v] of Object.entries(params?.metadata ?? {})) {
        if (k && v) query[`metadata.${k}`] = v
      }
      for (const [k, v] of Object.entries(params?.metadataNot ?? {})) {
        if (k && v) query[`metadataNot.${k}`] = v
      }
      return fetchApi<ApiResponse<PaginatedResponse<FriendListItem>>>(
        '/api/friends?' + new URLSearchParams(query)
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<FriendDetail>>(`/api/friends/${id}`),
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
  tags: {
    /** withCounts で friendCount 付き (JOIN 集計 — タグ管理ページ用)。 */
    list: (params?: { withCounts?: boolean }) =>
      fetchApi<ApiResponse<Tag[]>>(`/api/tags${params?.withCounts ? '?withCounts=1' : ''}`),
    /** CSVを保存せずに検査し、行ごとの扱いを返す。 */
    importPreview: (rows: TagCsvImportInputRow[]) =>
      fetchApi<ApiResponse<TagCsvImportPreview>>('/api/tags/import/preview', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    /** 保存直前に再検査し、登録できる行だけをまとめて作る。 */
    importCsv: (rows: TagCsvImportInputRow[]) =>
      fetchApi<ApiResponse<TagCsvImportResult>>('/api/tags/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    /**
     * 削除する前に、何が失われるかを数えて返す（PR #381）。
     *
     * **DELETE 側にはまだ強制停止が入っていない。** 止めるのは画面の役目で、
     * `canDelete: false` のときにボタンを押せなくする。取れなかったときも
     * 押せなくする（「参照0件」と読み違えて消させないため）。
     * 権限は owner / admin。
     */
    deleteImpact: (id: string) =>
      fetchApi<ApiResponse<TagDeleteImpact>>(`/api/tags/${id}/delete-impact`),
    // 色は受け取らない。印の色はフォルダ（tagGroups）に付く。
    create: (data: { name: string; groupId?: string | null }) =>
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
      /** true のときだけ、すでにこのタグが付いている人へ遡及する。 */
      applyToExisting?: boolean
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
    list: (accountId: string, params?: { folderId?: string; withUsage?: boolean }) => {
      const q = new URLSearchParams()
      q.set('lineAccountId', accountId)
      if (params?.folderId) q.set('folderId', params.folderId)
      if (params?.withUsage) q.set('withUsage', '1')
      const query = q.toString()
      return fetchApi<ApiResponse<FriendField[]>>(
        `/api/friend-fields${query ? `?${query}` : ''}`,
      )
    },
    stats: (accountId: string) =>
      fetchApi<ApiResponse<FriendFieldListSummary>>(
        `/api/friend-fields-stats?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    /** 値は変更せず、種類を変えた場合に確認が要る友だちだけを返す。 */
    migrationPreview: (id: string, accountId: string, targetType: FriendFieldType) =>
      fetchApi<ApiResponse<{
        source: FriendField
        summary: { total: number; convertible: number; review: number; invalid: number }
        rows: Array<{
          friendId: string
          sourceValue: string
          convertedValue: string | null
          status: 'review' | 'invalid'
          reason: string | null
        }>
      }>>(
        `/api/friend-fields/${id}/migration-preview?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify({ targetType }) },
      ),
    create: (accountId: string, data: {
      name: string
      fieldKey: string
      type: FriendFieldType
      folderId?: string | null
      options?: string[] | null
      defaultValue?: string | null
      ecFieldPath?: string | null
      ecIsMaster?: boolean
      isPersonal?: boolean
      isStarred?: boolean
      displayOrder?: number
    }) =>
      fetchApi<ApiResponse<FriendField>>(
        `/api/friend-fields?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'POST',
        body: JSON.stringify(data),
        },
      ),
    update: (
      id: string,
      accountId: string,
      data: Partial<
        Pick<
          FriendField,
          'name' | 'folderId' | 'defaultValue' | 'isPersonal' | 'isStarred' | 'displayOrder'
        >
      > & { options?: string[] | null },
    ) =>
      fetchApi<ApiResponse<FriendField>>(`/api/friend-fields/${id}?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 値が入っている項目は409。物理削除せず移行する。 */
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(
        `/api/friend-fields/${id}?lineAccountId=${encodeURIComponent(accountId)}`,
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
    list: (accountId: string) =>
      fetchApi<ApiResponse<Array<SupportMark & { friendCount: number }>>>(
        `/api/support-marks?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    create: (accountId: string, data: {
      name: string
      color?: string
      isDefault?: boolean
      autoOnInbound?: boolean
      displayOrder?: number
    }) =>
      fetchApi<ApiResponse<SupportMark>>(
        `/api/support-marks?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'POST',
        body: JSON.stringify(data),
        },
      ),
    update: (
      id: string,
      accountId: string,
      data: Partial<Pick<SupportMark, 'name' | 'color' | 'isDefault' | 'autoOnInbound' | 'displayOrder'>>,
    ) =>
      fetchApi<ApiResponse<SupportMark>>(
        `/api/support-marks/${id}?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'PATCH',
        body: JSON.stringify(data),
        },
      ),
    /** 影響が確認時から変わっていない場合だけ、友だちを置換してマークを保管する。 */
    delete: (id: string, accountId: string, data: {
      replacementMarkId: string
      expectedImpact: {
        friendCount: number
        usedIn: NonNullable<SupportMark['usedIn']>
      }
    }) =>
      fetchApi<ApiResponse<{
        archived: true
        replacedFriendCount: number
        replacementMark: SupportMark
      }>>(
        `/api/support-marks/${id}?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE', body: JSON.stringify(data) },
      ),
    setForFriend: (friendId: string, accountId: string, markId: string | null) =>
      fetchApi<ApiResponse<null>>(
        `/api/friends/${friendId}/support-mark?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'PATCH',
        body: JSON.stringify({ markId }),
        },
      ),
    bulk: (friendIds: string[], accountId: string, markId: string | null) =>
      fetchApi<ApiResponse<{ updated: number }>>(
        `/api/friends/support-mark/bulk?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'POST',
        body: JSON.stringify({ friendIds, markId }),
        },
      ),
    /*
      自動変更ルール。**まだ Worker に無い口を呼ぶことがある**（API は
      skmtmst/line-harness-oss#758）。呼び出し側は 404 を「未接続」として
      扱い、押しても何も起きない操作を並べない。
    */
    automationRules: (markId: string, accountId: string) =>
      fetchApi<ApiResponse<SupportMarkAutomationRule[]>>(
        `/api/support-marks/${markId}/automation-rules?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    createAutomationRule: (
      markId: string,
      accountId: string,
      data: SaveSupportMarkAutomationRule,
    ) => fetchApi<ApiResponse<SupportMarkAutomationRule>>(
      `/api/support-marks/${markId}/automation-rules?lineAccountId=${encodeURIComponent(accountId)}`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    updateAutomationRule: (
      ruleId: string,
      accountId: string,
      expectedVersion: number,
      data: SaveSupportMarkAutomationRule,
    ) => fetchApi<ApiResponse<SupportMarkAutomationRule>>(
      `/api/support-mark-rules/${ruleId}?lineAccountId=${encodeURIComponent(accountId)}`,
      { method: 'PATCH', body: JSON.stringify({ ...data, expectedVersion }) },
    ),
    archiveAutomationRule: (ruleId: string, accountId: string, expectedVersion: number) =>
      fetchApi<ApiResponse<null>>(
        `/api/support-mark-rules/${ruleId}?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE', body: JSON.stringify({ expectedVersion }) },
      ),
  },
  /** 保存した検索。上限50件。 */
  savedSearches: {
    list: (accountId: string) =>
      fetchApi<ApiResponse<SavedSearch[]>>(
        `/api/saved-searches?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    create: (data: {
      name: string
      accountId: string
      conditions: unknown
      isShared?: boolean
    }) =>
      fetchApi<ApiResponse<SavedSearch>>(`/api/saved-searches?lineAccountId=${encodeURIComponent(data.accountId)}`, {
        method: 'POST',
        body: JSON.stringify({ name: data.name, conditions: data.conditions, isShared: data.isShared }),
      }),
    update: (id: string, accountId: string, data: { name?: string; conditions?: unknown; isShared?: boolean }) =>
      fetchApi<ApiResponse<SavedSearch>>(`/api/saved-searches/${id}?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(`/api/saved-searches/${id}?lineAccountId=${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
  },
  /** 一斉配信などで再利用する共通の対象条件。旧い友だち検索とは形を混ぜない。 */
  segmentPresets: {
    list: (accountId: string) =>
      fetchApi<ApiResponse<SavedSegmentPreset[]>>(
        `/api/saved-searches?format=segment_v1&lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    create: (data: { name: string; accountId: string; condition: SegmentCondition; isShared?: boolean }) =>
      fetchApi<ApiResponse<SavedSegmentPreset>>(
        `/api/saved-searches?format=segment_v1&lineAccountId=${encodeURIComponent(data.accountId)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: data.name,
            conditions: {
              version: 1,
              condition: data.condition as SavedSegmentConditions['condition'],
            } satisfies SavedSegmentConditions,
            isShared: data.isShared,
          }),
        },
      ),
    update: (
      id: string,
      accountId: string,
      data: { name?: string; condition?: SegmentCondition; isShared?: boolean },
    ) =>
      fetchApi<ApiResponse<SavedSegmentPreset>>(
        `/api/saved-searches/${id}?format=segment_v1&lineAccountId=${encodeURIComponent(accountId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: data.name,
            conditions: data.condition
              ? ({
                  version: 1,
                  condition: data.condition as SavedSegmentConditions['condition'],
                } satisfies SavedSegmentConditions)
              : undefined,
            isShared: data.isShared,
          }),
        },
      ),
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(
        `/api/saved-searches/${id}?format=segment_v1&lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
      ),
  },
  /**
   * 機能のオン／オフ。account_settings の key/value に入る。
   * 切ったものだけが記録され、記録が無ければ有効。
   */
  featureSettings: {
    get: (accountId: string) =>
      fetchApi<ApiResponse<{
        features: Record<string, boolean>
        sidebarOrder: string[] | null
        /** 区分ごとの項目の並び。区分の目印 → 項目の目印の並び。 */
        sidebarItemOrder: Record<string, string[]> | null
        parentChildMode: boolean
        specializedFeatureKeys: string[]
      }>>(
        `/api/settings/features?account_id=${encodeURIComponent(accountId)}`,
      ),
    save: (accountId: string, data: {
      features?: Record<string, boolean>
      sidebarOrder?: string[]
      sidebarItemOrder?: Record<string, string[]>
    }) =>
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
    friendsOverview: (accountId: string, params?: { from?: string; to?: string }) =>
      fetchApi<ApiResponse<AnalyticsFriendsOverview>>(
        `/api/analytics/friends${rangeQuery({ ...params, accountId })}`,
      ),
    reactionsOverview: (accountId: string, params?: { from?: string; to?: string }) =>
      fetchApi<ApiResponse<AnalyticsReactionsOverview>>(
        `/api/analytics/reactions${rangeQuery({ ...params, accountId })}`,
      ),
    routesOverview: (accountId: string, params?: { from?: string; to?: string }) =>
      fetchApi<ApiResponse<AnalyticsRoutesOverview>>(
        `/api/analytics/routes${rangeQuery({ ...params, accountId })}`,
      ),
    usageOverview: (accountId: string, params?: { from?: string; to?: string }) =>
      fetchApi<ApiResponse<AnalyticsUsageOverview>>(
        `/api/analytics/usage${rangeQuery({ ...params, accountId })}`,
      ),
    urlClicksOverview: (
      accountId: string,
      params?: { from?: string; to?: string; limit?: number },
    ) => {
      const query = new URLSearchParams()
      query.set('account_id', accountId)
      if (params?.from) query.set('from', params.from)
      if (params?.to) query.set('to', params.to)
      if (params?.limit) query.set('limit', String(params.limit))
      return fetchApi<ApiResponse<AnalyticsUrlClicksOverview>>(
        `/api/analytics/url-clicks?${query.toString()}`,
      )
    },
    messages: (accountId: string, params?: { from?: string; to?: string }) =>
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
      >(`/api/analytics/messages${rangeQuery({ ...params, accountId })}`),
    /** 測定中のURL。1回も押されていないものも返る */
    trackedLinks: (accountId: string, params?: { from?: string; to?: string }) =>
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
      >(`/api/analytics/tracked-links${rangeQuery({ ...params, accountId })}`),
    linkClicks: (accountId: string, params?: { from?: string; to?: string }) =>
      fetchApi<
        ApiResponse<
          Array<{ trackedLinkId: string; name: string; clicks: number; uniqueFriends: number }>
        >
      >(`/api/analytics/link-clicks${rangeQuery({ ...params, accountId })}`),
    broadcasts: (accountId: string, params?: { from?: string; to?: string }) =>
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
      >(`/api/analytics/broadcasts${rangeQuery({ ...params, accountId })}`),
    cross: (accountId: string, fieldId: string) =>
      fetchApi<ApiResponse<Array<{ row: string; col: string; count: number }>>>(
        `/api/analytics/cross?account_id=${encodeURIComponent(accountId)}&fieldId=${encodeURIComponent(fieldId)}`,
      ),
    runCross: (accountId: string, data: {
      rowAxis: AnalyticsCrossAxis
      columnAxis: AnalyticsCrossAxis
      measure: { kind: 'unique_friends' }
      filters: []
      periodFrom: string
      periodTo: string
    }) => fetchApi<ApiResponse<{ id: string; state: 'pending' }>>(
      `/api/analytics/cross/query?account_id=${encodeURIComponent(accountId)}`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    crossResult: (accountId: string, id: string) =>
      fetchApi<ApiResponse<{
        id: string
        state: 'pending' | 'running' | 'available' | 'partial' | 'unavailable' | 'failed'
        errorCode: string | null
        result: AnalyticsCrossResult | null
        createdAt: string
      }>>(`/api/analytics/cross/results/${id}?account_id=${encodeURIComponent(accountId)}`),
    createResultAudience: (accountId: string, resultId: string, data: {
      sourceKind: 'cross' | 'funnel'
      rowKey?: string
      columnKey?: string
      groupKey?: string
      stepOrder?: number
      selection?: 'reached' | 'stopped' | 'in_progress'
    }) => fetchApi<ApiResponse<{ id: string; memberCount: number; expiresAt: string }>>(
      `/api/analytics/results/${resultId}/audiences?account_id=${encodeURIComponent(accountId)}`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    v6Funnels: {
      list: (accountId: string) => fetchApi<ApiResponse<Array<{
        id: string
        name: string
        windowDays: number
        createdAt: string
        currentVersion: { id: string; versionNumber: number; createdAt: string } | null
        migrationState: 'ready' | 'needs_migration'
      }>>>(`/api/analytics/funnels?account_id=${encodeURIComponent(accountId)}`),
      create: (accountId: string, data: {
        name: string
        windowDays: number
        steps: Array<{ label: string; kind: string; match: Record<string, string> }>
      }) => fetchApi<ApiResponse<{ funnelId: string; version: { id: string; versionNumber: number } }>>(
        `/api/analytics/funnels?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
      latestRun: (accountId: string, funnelId: string) =>
        fetchApi<ApiResponse<AnalyticsFunnelRunResult>>(
          `/api/analytics/funnels/${funnelId}/runs/latest?account_id=${encodeURIComponent(accountId)}`,
        ),
      run: (accountId: string, funnelId: string, data: { cohortFrom: string; cohortTo: string }) =>
        fetchApi<ApiResponse<AnalyticsFunnelRunResult>>(
          `/api/analytics/funnels/${funnelId}/run?account_id=${encodeURIComponent(accountId)}`,
          { method: 'POST', body: JSON.stringify(data) },
        ),
    },
    saved: {
      list: (accountId: string) => fetchApi<ApiResponse<SavedAnalyticsSummary[]>>(
        `/api/analytics/saved?account_id=${encodeURIComponent(accountId)}`,
      ),
      create: (accountId: string, data: {
        name: string
        sourceKind: 'cross' | 'funnel'
        sourceResultId: string
      }) => fetchApi<ApiResponse<{ id: string; versionId: string; snapshotId: string }>>(
        `/api/analytics/saved?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
      snapshots: (accountId: string, id: string) =>
        fetchApi<ApiResponse<SavedAnalyticsSnapshot[]>>(
          `/api/analytics/saved/${id}/snapshots?account_id=${encodeURIComponent(accountId)}`,
        ),
    },
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
            userName: string
            role: 'admin' | 'staff' | 'viewer' | null
            lineLinked: boolean
            isActive: boolean
            action: string
            screen: string | null
            ip: string | null
            connectionSource: string | null
            result: string
            createdAt: string
          }>
        >
      >(`/api/login-audit${query ? `?${query}` : ''}`)
    },
  },
  /** 回答フォーム。 */
  forms: {
    list: (accountId: string) =>
      fetchApi<ApiResponse<Array<{ id: string; name: string; description: string | null }>>>(
        `/api/forms?account_id=${encodeURIComponent(accountId)}`,
      ),
    get: (id: string, accountId: string) =>
      fetchApi<
        ApiResponse<{
          id: string
          name: string
          description: string | null
          fields: unknown
          /** ブロック・セクション・オプションの入れ物。古いフォームでも必ず入る */
          layout: FormLayout
          onSubmitTagId: string | null
          onSubmitMessageType: string | null
          onSubmitMessageContent: string | null
          isActive: boolean
          submitCount: number
        }>
      >(`/api/forms/${id}?account_id=${encodeURIComponent(accountId)}`),
    create: (
      accountId: string,
      data: { name: string; description?: string | null; layout?: FormLayout },
    ) =>
      fetchApi<ApiResponse<{ id: string }>>('/api/forms', {
        method: 'POST',
        body: JSON.stringify({ ...data, accountId }),
      }),
    createDraft: (accountId: string, name?: string) =>
      fetchApi<ApiResponse<{ id: string; isActive: boolean }>>('/api/forms/drafts', {
        method: 'POST',
        body: JSON.stringify({ name, accountId }),
      }),
    update: (
      id: string,
      accountId: string,
      data: {
        name?: string
        description?: string | null
        fields?: unknown
        /** 送ると fields もこちらから作り直される */
        layout?: FormLayout
        onSubmitTagId?: string | null
        onSubmitMessageType?: string | null
        onSubmitMessageContent?: string | null
        isActive?: boolean
      },
    ) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/forms/${id}?account_id=${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteImpact: (id: string, accountId: string) =>
      fetchApi<ApiResponse<FormDeleteImpact>>(
        `/api/forms/${id}/delete-impact?account_id=${encodeURIComponent(accountId)}`,
      ),
    archive: (id: string, accountId: string, expectedRevision: number) =>
      fetchApi<ApiResponse<{
        status: 'archived'
        archivedAt: string
        retainedSubmissionCount: number
        retainedOpenCount: number
        retainedReferenceCount: number
        answerUrlUnavailable: true
      }>>(`/api/forms/${id}/archive?account_id=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision }),
      }),
    remove: (id: string, accountId: string, expectedRevision?: number) =>
      fetchApi<ApiResponse<null>>(
        `/api/forms/${id}?account_id=${encodeURIComponent(accountId)}${
          expectedRevision == null ? '' : `&expected_revision=${encodeURIComponent(String(expectedRevision))}`
        }`,
        { method: 'DELETE' },
      ),
  },
  /** NENコラム。 */
  nenColumns: {
    list: (accountId: string) =>
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
      >(`/api/nen-campaigns/columns?lineAccountId=${encodeURIComponent(accountId)}`),
    /** コラムに添える紹介文。本文そのものはEC側にある。 */
    updateMessage: (accountId: string, id: string, introText: string) =>
      fetchApi<ApiResponse<null>>(`/api/nen-campaigns/columns/${id}/message?lineAccountId=${encodeURIComponent(accountId)}`, {
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
    list: (accountId: string) =>
      fetchApi<ApiResponse<Array<{ id: string; name: string; windowDays: number; createdAt: string }>>>(
        `/api/funnels?account_id=${encodeURIComponent(accountId)}`,
      ),
    create: (accountId: string, data: {
      name: string
      windowDays?: number
      steps: Array<{ label: string; kind: string; match: unknown }>
    }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/funnels?account_id=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (accountId: string, id: string) => fetchApi<ApiResponse<null>>(
      `/api/funnels/${id}?account_id=${encodeURIComponent(accountId)}`,
      { method: 'DELETE' },
    ),
    result: (accountId: string, id: string, params?: { from?: string; to?: string }) =>
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
      >(`/api/funnels/${id}/result${rangeQuery({ ...params, accountId })}`),
  },
  /** メディアライブラリ。1か所に置いて使い回す。 */
  media: {
    list: (accountId: string, params?: { kind?: string; folderId?: string }) => {
      const q = new URLSearchParams()
      q.set('accountId', accountId)
      if (params?.kind) q.set('kind', params.kind)
      if (params?.folderId) q.set('folderId', params.folderId)
      const query = q.toString()
      return fetchApi<ApiResponse<MediaItem[]>>(`/api/media${query ? `?${query}` : ''}`)
    },
    /** data は base64。data: URL 形式でも受け付ける。 */
    upload: (data: {
      accountId: string
      filename: string
      mimeType: string
      data: string
      folderId?: string | null
    }) =>
      fetchApi<ApiResponse<MediaItem>>('/api/media', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, accountId: string, data: { filename?: string; folderId?: string | null }) =>
      fetchApi<ApiResponse<MediaItem>>(`/api/media/${id}?accountId=${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    usages: (id: string, accountId: string) => fetchApi<ApiResponse<MediaUsage[]>>(`/api/media/${id}/usages?accountId=${encodeURIComponent(accountId)}`),
    /** 削除確認を開くたびに、現在の使用先と削除可否を読み直す。 */
    deleteImpact: (id: string, accountId: string) =>
      fetchApi<ApiResponse<MediaDeleteImpact>>(
        `/api/media/${id}/delete-impact?accountId=${encodeURIComponent(accountId)}`,
      ),
    /** 差し替え前に、共有・参照不明を含む現在の使用先を読み直す。 */
    replacementImpact: (id: string, replacementId: string, accountId: string) =>
      fetchApi<ApiResponse<MediaReplacementImpact>>(
        `/api/media/${id}/replacement-impact?accountId=${encodeURIComponent(accountId)}&replacementId=${encodeURIComponent(replacementId)}`,
      ),
    replaceUsages: (
      id: string,
      accountId: string,
      input: { replacementMediaId: string; expectedRevision: string },
    ) => fetchApi<ApiResponse<MediaReplacementResult>>(
      `/api/media/${id}/replace-usages?accountId=${encodeURIComponent(accountId)}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
    /** 使用中は 409 で止まり、使用先から外すまで消せない。 */
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(`/api/media/${id}?accountId=${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      }),
  },
  /** 共通情報。営業時間などを1か所で直す。 */
  commonVars: {
    list: (accountId: string, params?: { folderId?: string }) =>
      fetchApi<ApiResponse<CommonVar[]>>(
        `/api/common-vars?accountId=${encodeURIComponent(accountId)}${params?.folderId ? `&folderId=${encodeURIComponent(params.folderId)}` : ''}`,
      ),
    create: (data: {
      accountId: string
      name: string
      varKey: string
      type?: string
      value?: string
      folderId?: string | null
    }) =>
      fetchApi<ApiResponse<CommonVar>>('/api/common-vars', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /** varKey は変えられない（テンプレートの差し込みが空になるため）。 */
    update: (id: string, accountId: string, data: { name?: string; value?: string; folderId?: string | null }) =>
      fetchApi<ApiResponse<CommonVar>>(`/api/common-vars/${id}?accountId=${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    deleteImpact: (id: string, accountId: string) =>
      fetchApi<ApiResponse<CommonVarDeleteImpact>>(`/api/common-vars/${id}/delete-impact?accountId=${encodeURIComponent(accountId)}`),
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(`/api/common-vars/${id}?accountId=${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
    schedules: (id: string, accountId: string) =>
      fetchApi<ApiResponse<CommonVarSchedule[]>>(`/api/common-vars/${id}/schedules?accountId=${encodeURIComponent(accountId)}`),
    addSchedule: (id: string, accountId: string, data: { effectiveFrom: string; value: string }) =>
      fetchApi<ApiResponse<CommonVarSchedule>>(`/api/common-vars/${id}/schedules?accountId=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteSchedule: (id: string, scheduleId: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(`/api/common-vars/${id}/schedules/${scheduleId}?accountId=${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      }),
  },
  /** 汎用フォルダ。一覧13画面で共通に使う。 */
  folders: {
    list: (kind?: string) =>
      fetchApi<ApiResponse<Folder[]>>(`/api/folders${kind ? `?kind=${kind}` : ''}`),
    /** 色（#RRGGBB）はフォルダに付く。中身の印にこの色が出る。 */
    create: (data: { kind: string; name: string; parentId?: string | null; color?: string | null }) =>
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
    /** 色（#RRGGBB）はこのフォルダに付く。属するタグの印に出る。 */
    create: (data: { name: string; sortOrder?: number; color?: string | null }) =>
      fetchApi<ApiResponse<TagGroup>>('/api/tag-groups', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; sortOrder?: number; color?: string | null }) =>
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
        /** 1通ごとの配信対象。null は「購読中の全員に配信する」。 */
        targetCondition?: unknown
        /** 質問メッセージ（分岐）。 */
        question?: unknown
        isDraft?: boolean
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
        targetCondition?: unknown
        question?: unknown
        isDraft?: boolean
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
    /** この友だちをこのシナリオに登録する（1人ぶん）。 */
    enroll: (scenarioId: string, friendId: string) =>
      fetchApi<ApiResponse<unknown>>(
        `/api/scenarios/${scenarioId}/enroll/${friendId}`,
        { method: 'POST' },
      ),
    stats: (id: string) =>
      fetchApi<ApiResponse<{
        enrolledTotal: number
        activeNow: number
        completed: number
        paused: number
        steps: Array<{ stepOrder: number; reachedCount: number; reachRate: number }>
      }>>(`/api/scenarios/${id}/stats`),

    /* ---- アクション（Lステップの「アクション設定」にあたる） ---- */
    actions: {
      list: (scenarioId: string) =>
        fetchApi<ApiResponse<ScenarioAction[]>>(`/api/scenarios/${scenarioId}/actions`),
      create: (
        scenarioId: string,
        data: {
          hook: ScenarioActionHook
          stepId?: string | null
          choiceIndex?: number | null
          actionType: ScenarioActionType
          config: unknown
          condition?: unknown
          repeatOnRefire?: boolean
          sortOrder?: number
        },
      ) =>
        fetchApi<ApiResponse<ScenarioAction>>(`/api/scenarios/${scenarioId}/actions`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (
        scenarioId: string,
        actionId: string,
        data: { config?: unknown; condition?: unknown; repeatOnRefire?: boolean; sortOrder?: number },
      ) =>
        fetchApi<ApiResponse<ScenarioAction>>(`/api/scenarios/${scenarioId}/actions/${actionId}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      remove: (scenarioId: string, actionId: string) =>
        fetchApi<ApiResponse<null>>(`/api/scenarios/${scenarioId}/actions/${actionId}`, {
          method: 'DELETE',
        }),
    },

    /* ---- 開始のきっかけ。1本に複数持てる ---- */
    triggers: {
      list: (scenarioId: string) =>
        fetchApi<ApiResponse<ScenarioTriggerItem[]>>(`/api/scenarios/${scenarioId}/triggers`),
      add: (scenarioId: string, kind: 'friend_add' | 'tag_added', tagId?: string | null) =>
        fetchApi<ApiResponse<ScenarioTriggerItem[]>>(`/api/scenarios/${scenarioId}/triggers`, {
          method: 'POST',
          body: JSON.stringify({ kind, tagId: tagId ?? null }),
        }),
      remove: (scenarioId: string, triggerId: string) =>
        fetchApi<ApiResponse<null>>(`/api/scenarios/${scenarioId}/triggers/${triggerId}`, {
          method: 'DELETE',
        }),
    },

    /* ---- テスト送信。購読の状態は動かさない ---- */
    testSend: (scenarioId: string, friendId: string) =>
      fetchApi<ApiResponse<{ sent: number }>>(`/api/scenarios/${scenarioId}/test-send`, {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      }),
    testSendStep: (scenarioId: string, stepId: string, friendId: string) =>
      fetchApi<ApiResponse<{ sent: number }>>(
        `/api/scenarios/${scenarioId}/steps/${stepId}/test-send`,
        { method: 'POST', body: JSON.stringify({ friendId }) },
      ),
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
      /**
       * 絞り込み条件。targetType が 'segment' のときに必須。
       * 下書きに保存され、送信のときにこの条件で宛先を出す。
       */
      /*
       * 宛先の条件。形は worker の `SegmentCondition` と同じ。
       * 値の型はルールごとに違う（真偽・文字列・日付の範囲・ID の配列）ので
       * ここでは絞らない。絞ると、条件を1つ増やすたびにここも直すことになり、
       * 直し忘れたぶんが**画面では作れるのに保存できない条件**になる。
       */
      segmentConditions?: SegmentCondition
      folderId?: string | null
      measureOpens?: boolean
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
      /** 詳細条件。渡さないと条件を無視した人数（＝全員）が返る。 */
      segmentConditions?: SegmentCondition | null
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
        messageBubbles?: BroadcastBubble[]
        targetType?: ApiBroadcast['targetType']
        targetTagId?: string | null
        segmentConditions?: SegmentCondition | null
        scheduledAt?: string | null
        trackLinks?: boolean
        folderId?: string | null
        measureOpens?: boolean
        stealthSpreadMinutes?: number
        lineAccountId?: string | null
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
  tenants: {
    me: () => fetchApi<ApiResponse<{ name: string }>>('/api/tenants/me'),
    updateName: (name: string) =>
      fetchApi<ApiResponse<{ name: string }>>('/api/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
  },
  lineAccounts: {
    list: (live = false) =>
      fetchApi<ApiResponse<LineAccount[]>>(`/api/line-accounts${live ? '?live=1' : ''}`),
    summary: () =>
      fetchApi<ApiResponse<{ uniqueFriendCount: number }>>('/api/line-accounts/summary'),
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
      copyFromAccountId?: string | null;
      copyItems?: Array<'accountSettings' | 'scenarios' | 'autoReplies'>;
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
    updateHierarchy: (relationships: Array<{ id: string; parentLineAccountId: string | null }>) =>
      fetchApi<ApiResponse<Array<{ id: string; parentLineAccountId: string | null }>>>(
        '/api/line-accounts/hierarchy',
        { method: 'PATCH', body: JSON.stringify({ relationships }) },
      ),
    verifyConnection: (data: {
      channelAccessToken: string;
      loginChannelId: string;
      loginChannelSecret: string;
      liffId: string;
    }) => fetchApi<ApiResponse<{
      messagingApi: boolean;
      webhook: boolean;
      lineLogin: boolean;
      liff: boolean;
      webhookUrl: string | null;
      errors: string[];
    }>>('/api/line-accounts/verify-connection', {
      method: 'POST', body: JSON.stringify(data),
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
          bankDestination: false
          settlementSchedule: false
        }
        error?: string
      }>(`/api/affiliate-payments?${new URLSearchParams({ lineAccountId })}`),
  },
  templates: {
    list: (category?: string, accountId?: string) => {
      const query = new URLSearchParams()
      if (category) query.set('category', category)
      if (accountId) query.set('account_id', accountId)
      const suffix = query.size ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<Array<{
        id: string;
        accountId: string | null;
        name: string;
        category: string;
        messageType: string;
        messageContent: string;
        folderId: string | null;
        question: TemplateQuestion | null;
        questionStatus: 'draft' | 'published';
        usageCount: number;
        /** 162: 選択肢が押された回数の合計。押される仕掛けが無いものは 0。 */
        tapCount: number;
        createdAt: string;
        updatedAt: string;
      }>>>(
        `/api/templates${suffix}`,
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<{
        id: string;
        accountId: string | null;
        name: string;
        category: string;
        messageType: string;
        messageContent: string;
        question: TemplateQuestion | null;
        questionStatus: 'draft' | 'published';
        /** 162: 選択肢を押したときの動き。{ パネル番号: { 選択肢番号: [...] } } */
        carouselActions: unknown | null;
        /** 162: 'none'（制限なし）／'once'（全体で1回） */
        carouselTapLimitMode: string;
        /** 162: 制限を超えたときに返すテキスト。 */
        carouselTapLimitText: string | null;
        usedBy: {
          autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>;
          automations: Array<{ id: string; name: string; eventType: string }>;
          scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepId: string; stepOrder: number }>;
          reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>;
          richMenuAreas: Array<{ groupId: string; groupName: string; pageName: string; areaId: string; label: string | null }>;
          trackedLinks: Array<{ id: string; name: string }>;
        };
        createdAt: string;
        updatedAt: string;
      }>>(
        `/api/templates/${id}`,
      ),
    create: (data: {
      accountId: string
      name: string
      category: string
      messageType: string
      messageContent: string
      question?: TemplateQuestion | null
      questionStatus?: 'draft' | 'published'
      /** 162: 選択肢を押したときの動き。 */
      carouselActions?: unknown | null
      /** 162: 'none'（制限なし）／'once'（全体で1回） */
      carouselTapLimitMode?: 'none' | 'once'
      /** 162: 制限を超えたときに返すテキスト。 */
      carouselTapLimitText?: string | null
    }) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        '/api/templates',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    update: (
      id: string,
      data: Partial<{ name: string; category: string; messageType: string; messageContent: string; question: TemplateQuestion | null; questionStatus: 'draft' | 'published' }> & {
        carouselActions?: unknown | null
        carouselTapLimitMode?: 'none' | 'once'
        carouselTapLimitText?: string | null
      },
    ) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        `/api/templates/${id}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/templates/${id}`, { method: 'DELETE' }),
    usages: (id: string) =>
      fetchApi<ApiResponse<{
        autoReplies: Array<{ id: string; keyword: string; lineAccountId: string | null }>;
        automations: Array<{ id: string; name: string; eventType: string }>;
        scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepId: string; stepOrder: number }>;
        reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>;
        richMenuAreas: Array<{ groupId: string; groupName: string; pageName: string; areaId: string; label: string | null }>;
        trackedLinks: Array<{ id: string; name: string }>;
      }>>(`/api/templates/${id}/usages`),
  },
  autoReplies: {
    /**
     * 実行の記録（設計 `t7UtYQ` 8-1-H）。
     * **どのルールが、いつ、誰へ、どう返したか。** 設定だけ見ても、
     * 実際に返したのかは分からない。
     */
    runs: (params?: { ruleId?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.ruleId) query.set('rule_id', params.ruleId)
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.offset !== undefined) query.set('offset', String(params.offset))
      const suffix = query.toString() ? `?${query}` : ''
      return fetchApi<ApiResponse<AutoReplyRunsResponse>>(`/api/auto-reply-runs${suffix}`)
    },
    /*
      公開までの4段（下書き→検査→競合→試験→公開）。**口はすべて
      `apps/worker/src/routes/auto-replies.ts` に在るものを読むだけ。**
      公開は `Idempotency-Key` を付ける——二度押しで2回公開すると、
      同じ変更が2つの版として台帳に残る。
    */
    createDraft: (body: AutoReplyDraftInput) =>
      fetchApi<ApiResponse<AutoReplyDraftVersion>>('/api/auto-replies/drafts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getDraft: (id: string) =>
      fetchApi<ApiResponse<AutoReplyDraftVersion>>(`/api/auto-replies/${id}/draft`),
    saveDraft: (id: string, body: AutoReplyDraftInput) =>
      fetchApi<ApiResponse<AutoReplyDraftVersion>>(`/api/auto-replies/${id}/draft`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    validateDraft: (id: string) =>
      fetchApi<ApiResponse<AutoReplyValidationResult>>(`/api/auto-replies/${id}/validate`, {
        method: 'POST',
      }),
    conflicts: (id: string) =>
      fetchApi<ApiResponse<{ conflicts: AutoReplyConflict[] }>>(`/api/auto-replies/${id}/conflicts`),
    testDraft: (id: string, body: {
      friendId: string;
      incomingText: string;
      messageKind?: string;
      occurredAt?: string;
    }) => fetchApi<ApiResponse<AutoReplyDryRunResult>>(`/api/auto-replies/${id}/test`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    publishDraft: (
      id: string,
      body: { acknowledgedConflictIds: string[] },
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<AutoReplyPublishResult>>(`/api/auto-replies/${id}/publish`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
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
        actions: unknown[] | null;
        responseWeekdays: number[] | null;
        responseHolidayRule: string | null;
        oncePerFriend: boolean;
        keywords: unknown[] | null;
        friendConditions: unknown | null;
        /** 157: キーワードを問わず、届いたメッセージすべてに応答する。 */
        respondToAll: boolean;
        /** 158: 管理用の名前。 */
        name: string | null;
        /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
        keywordMatchMode: string;
        /** フォルダ。分けていなければ null。 */
        folderId: string | null;
        /** 152: 当たった回数（今月・累計）。一覧でだけ入る。 */
        hits?: { period: number; total: number };
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
        actions: unknown[] | null;
        responseWeekdays: number[] | null;
        responseHolidayRule: string | null;
        oncePerFriend: boolean;
        keywords: unknown[] | null;
        friendConditions: unknown | null;
        respondToAll: boolean;
        name: string | null;
        keywordMatchMode: string;
        /** フォルダ。分けていなければ null。 */
        folderId: string | null;
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
      /** 151: 応答したときに順に実行すること。 */
      actions?: unknown[] | null;
      /** 151: 応答する曜日（0=日 … 6=土）。null で曜日を問わない */
      responseWeekdays?: number[] | null;
      /** 151: 'ignore' | 'include' | 'exclude' */
      responseHolidayRule?: string | null;
      /** 151: 1人につき1回だけ応答する */
      oncePerFriend?: boolean;
      /** 151: キーワードの複数行 */
      keywords?: unknown[] | null;
      /** 友だちの絞り込み（一斉配信・シナリオと同じ形） */
      friendConditions?: unknown | null;
      /** 157: キーワードを問わず応答する。 */
      respondToAll?: boolean;
      /** 158: 管理用の名前。 */
      name?: string | null;
      /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
      keywordMatchMode?: 'any' | 'all';
      /** フォルダ。 */
      folderId?: string | null;
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
      /** 151: 応答したときに順に実行すること。 */
      actions?: unknown[] | null;
      /** 151: 応答する曜日（0=日 … 6=土）。null で曜日を問わない */
      responseWeekdays?: number[] | null;
      /** 151: 'ignore' | 'include' | 'exclude' */
      responseHolidayRule?: string | null;
      /** 151: 1人につき1回だけ応答する */
      oncePerFriend?: boolean;
      /** 151: キーワードの複数行 */
      keywords?: unknown[] | null;
      /** 友だちの絞り込み（一斉配信・シナリオと同じ形） */
      friendConditions?: unknown | null;
      /** 157: キーワードを問わず応答する。 */
      respondToAll?: boolean;
      /** 158: 管理用の名前。 */
      name?: string | null;
      /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
      keywordMatchMode?: 'any' | 'all';
      /** フォルダ。 */
      folderId?: string | null;
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
    templates: (accountId: string) =>
      fetchApi<ApiResponse<AutomationTemplateSummary[]>>(
        `/api/automation-templates?account_id=${encodeURIComponent(accountId)}`,
      ),
    createDraftFromTemplate: (templateKey: string, accountId: string) =>
      fetchApi<ApiResponse<{ id: string; draftVersionId: string }>>(
        `/api/automation-templates/${encodeURIComponent(templateKey)}/drafts?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: '{}' },
      ),
    getDraft: (id: string, accountId: string) =>
      fetchApi<ApiResponse<AutomationDraftDetail>>(
        `/api/automation-drafts/${encodeURIComponent(id)}?account_id=${encodeURIComponent(accountId)}`,
      ),
    draftResources: (accountId: string) =>
      fetchApi<ApiResponse<{
        tags: Array<{ id: string; name: string }>
        scenarios: Array<{ id: string; name: string }>
      }>>(`/api/automation-draft-resources?account_id=${encodeURIComponent(accountId)}`),
    updateDraft: (id: string, accountId: string, data: {
      expectedDraftVersionId: string
      name: string
      eventType: AutomationDraftDetail['eventType']
      triggerConfig: Record<string, unknown>
      actions: AutomationDraftAction[]
    }) => fetchApi<ApiResponse<{ updated: true }>>(
      `/api/automation-drafts/${encodeURIComponent(id)}?account_id=${encodeURIComponent(accountId)}`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),
  },
  commonActions: {
    resources: (accountId: string, excludeId?: string) => {
      const query = new URLSearchParams({ account_id: accountId });
      if (excludeId) query.set('exclude_id', excludeId);
      return fetchApi<ApiResponse<CommonActionResources>>(`/api/common-actions/resources?${query}`);
    },
    list: (params: {
      accountId: string;
      status?: 'all' | 'draft' | 'published' | 'archived' | 'old_version' | 'unused';
      query?: string;
    }) => {
      const query = new URLSearchParams({ account_id: params.accountId });
      if (params.status && params.status !== 'all') query.set('status', params.status);
      if (params.query) query.set('query', params.query);
      return fetchApi<ApiResponse<CommonActionSummary[]>>(`/api/common-actions?${query}`);
    },
    get: (id: string, accountId: string) =>
      fetchApi<ApiResponse<CommonActionDetail>>(
        `/api/common-actions/${id}?account_id=${encodeURIComponent(accountId)}`,
      ),
    duplicate: (id: string, accountId: string) =>
      fetchApi<ApiResponse<{ id: string; draftVersionId: string; versionNumber: number }>>(
        `/api/common-actions/${id}/duplicate?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: '{}' },
      ),
    create: (accountId: string, data: {
      name: string;
      description?: string | null;
      actions: CommonActionStep[];
    }) => fetchApi<ApiResponse<{ id: string; draftVersionId: string; versionNumber: number }>>(
      `/api/common-actions?account_id=${encodeURIComponent(accountId)}`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    updateDraft: (id: string, accountId: string, data: {
      expectedDraftVersionId: string;
      name: string;
      description?: string | null;
      actions: CommonActionStep[];
    }) => fetchApi<ApiResponse<{ updated: true }>>(
      `/api/common-actions/${id}/draft?account_id=${encodeURIComponent(accountId)}`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),
    createDraft: (id: string, accountId: string, fromVersionId?: string) =>
      fetchApi<ApiResponse<{ draftVersionId: string; versionNumber: number }>>(
        `/api/common-actions/${id}/versions?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify({ fromVersionId }) },
      ),
    publish: (id: string, accountId: string, versionId: string) =>
      fetchApi<ApiResponse<{ versionId: string; versionNumber: number }>>(
        `/api/common-actions/${id}/versions/${versionId}/publish?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: '{}' },
      ),
    updateBinding: (id: string, accountId: string, bindingId: string, versionId: string) =>
      fetchApi<ApiResponse<{ updated: true }>>(
        `/api/common-actions/${id}/bindings/${bindingId}/version?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify({ versionId }) },
      ),
  },
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
  dashboard: {
    overview: (params: { period?: 'today' | 'last7' | 'last28'; accountId: string }) => {
      const query = new URLSearchParams()
      if (params?.period) query.set('period', params.period)
      query.set('account_id', params.accountId)
      const suffix = query.size ? `?${query}` : ''
      return fetchApi<ApiResponse<DashboardOverview>>(`/api/dashboard/overview${suffix}`)
    },
    organizationOverview: (params?: { period?: 'today' | 'last7' | 'last28' }) => {
      const query = new URLSearchParams()
      if (params?.period) query.set('period', params.period)
      const suffix = query.size ? `?${query}` : ''
      return fetchApi<ApiResponse<DashboardOverview>>(`/api/dashboard/organization-overview${suffix}`)
    },
    preferences: {
      get: (accountId: string) => fetchApi<ApiResponse<DashboardPreferenceResponse>>(
        `/api/dashboard/preferences?account_id=${encodeURIComponent(accountId)}`,
      ),
      save: (accountId: string, data: { version: number; cards: unknown }) =>
        fetchApi<ApiResponse<DashboardPreferenceResponse>>(
          `/api/dashboard/preferences?account_id=${encodeURIComponent(accountId)}`,
          { method: 'PUT', body: JSON.stringify(data) },
        ),
      reset: (accountId: string) => fetchApi<ApiResponse<null>>(
        `/api/dashboard/preferences?account_id=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
      ),
    },
  },
  ecCommerce: {
    overview: (lineAccountId?: string) =>
      fetchApi<ApiResponse<EcCommerceOverview>>(lineAccountId
        ? `/api/ec-commerce/overview?lineAccountId=${encodeURIComponent(lineAccountId)}`
        : '/api/ec-commerce/overview'),
    events: (params?: { lineAccountId?: string; eventType?: string; status?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams()
      if (params?.lineAccountId) query.set('lineAccountId', params.lineAccountId)
      if (params?.eventType) query.set('eventType', params.eventType)
      if (params?.status) query.set('status', params.status)
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.offset !== undefined) query.set('offset', String(params.offset))
      const suffix = query.size ? `?${query}` : ''
      return fetchApi<ApiResponse<EcCommerceEvent[]> & { pagination: { total: number; limit: number; offset: number } }>(
        `/api/ec-commerce/events${suffix}`,
      )
    },
    notificationRuns: (params: { lineAccountId: string; view?: 'all' | 'failures'; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ lineAccountId: params.lineAccountId })
      if (params.view) query.set('view', params.view)
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
      return fetchApi<ApiResponse<EcNotificationRunList> & { pagination: { total: number; limit: number; offset: number } }>(
        `/api/ec-commerce/notification-runs?${query}`,
      )
    },
    settings: () =>
      fetchApi<ApiResponse<EcNotificationSetting[]>>('/api/ec-commerce/settings'),
    updateSetting: (eventType: string, data: { isEnabled: boolean; title: string; introText: string; outroText: string; buttonLabel: string; buttonUrl: string; imageUrl: string }) =>
      fetchApi<{ success: boolean }>(`/api/ec-commerce/settings/${encodeURIComponent(eventType)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    testSend: (data: { eventType: string; accountId: string; title: string; introText: string; outroText: string; buttonLabel: string; buttonUrl: string; imageUrl: string }) =>
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
    getDraft: (accountId: string) =>
      fetchApi<ApiResponse<FriendAddRoutingVersion>>(
        `/api/friend-add-routing/draft?account_id=${encodeURIComponent(accountId)}`,
      ),
    saveDraft: (accountId: string, routing: FriendAddRouting) =>
      fetchApi<ApiResponse<FriendAddRoutingVersion>>(
        `/api/friend-add-routing/draft?account_id=${encodeURIComponent(accountId)}`,
        { method: 'PUT', body: JSON.stringify({ routing }) },
      ),
    validateDraft: (accountId: string) =>
      fetchApi<ApiResponse<FriendAddRoutingValidation>>(
        `/api/friend-add-routing/validate?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST' },
      ),
    conflicts: (accountId: string) =>
      fetchApi<ApiResponse<{ conflicts: FriendAddRoutingValidation['conflicts'] }>>(
        `/api/friend-add-routing/conflicts?account_id=${encodeURIComponent(accountId)}`,
      ),
    testDraft: (accountId: string, friendId: string) =>
      fetchApi<ApiResponse<FriendAddRoutingDraftTestResult>>(
        `/api/friend-add-routing/draft/test?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify({ friendId }) },
      ),
    publish: (accountId: string, idempotencyKey: string) =>
      fetchApi<ApiResponse<FriendAddRoutingPublishResult>>(
        `/api/friend-add-routing/publish?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
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
    /** V6履歴。Pencil共通デザイン側はこの返り値から各表示状態を組み立てる。 */
    events: (accountId: string, params?: {
      limit?: number
      cursor?: string
      kind?: FriendAddEventKind
      attributionStatus?: FriendAddEventAttributionStatus
      routingStatus?: FriendAddEventRoutingStatus
    }) => {
      const query = new URLSearchParams({ account_id: accountId })
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.cursor) query.set('cursor', params.cursor)
      if (params?.kind) query.set('kind', params.kind)
      if (params?.attributionStatus) query.set('attribution_status', params.attributionStatus)
      if (params?.routingStatus) query.set('routing_status', params.routingStatus)
      return fetchApi<ApiResponse<FriendAddEventList>>(`/api/friend-add-routing/events?${query}`)
    },
  },
  nenCampaigns: {
    overview: (accountId: string) => fetchApi<ApiResponse<{
      activeCampaigns: number
      jobs: { total: number; pending: number; sent: number; failed: number }
      columns: number
      pets: number
      coupons: number
    }>>(`/api/nen-campaigns/overview?lineAccountId=${encodeURIComponent(accountId)}`),
    settings: (accountId: string) => fetchApi<ApiResponse<NenCampaignSetting[]>>(
      `/api/nen-campaigns/settings?lineAccountId=${encodeURIComponent(accountId)}`,
    ),
    updateSetting: (accountId: string, campaignKey: string, data: Pick<NenCampaignSetting,
      'isEnabled' | 'title' | 'bodyText' | 'delayDays' | 'deliveryTime' | 'buttonLabel' | 'buttonUrl' | 'imageUrl'>) =>
      fetchApi<{ success: boolean }>(`/api/nen-campaigns/settings/${encodeURIComponent(campaignKey)}?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'PUT', body: JSON.stringify(data),
      }),
    testSend: (data: { campaignKey: string; accountId: string; friendId: string }) =>
      fetchApi<{ success: boolean }>('/api/nen-campaigns/test-send', { method: 'POST', body: JSON.stringify(data) }),
    jobs: (accountId: string) => fetchApi<ApiResponse<Array<{
      id: string; campaignKey: string; label: string; friendName: string | null
      scheduledAt: string; status: string; attempts: number; lastError: string | null; sentAt: string | null
    }>>>(`/api/nen-campaigns/jobs?lineAccountId=${encodeURIComponent(accountId)}`),
    columns: (accountId: string) => fetchApi<ApiResponse<NenColumn[]>>(
      `/api/nen-campaigns/columns?lineAccountId=${encodeURIComponent(accountId)}`,
    ),
    /** NENコラムの管理画面下書き。本文・slug・アカウントIDはWorkerで受け取らない。 */
    createColumn: (accountId: string, data: NenColumnCreateInput) =>
      fetchApi<ApiResponse<{ id: string }>>(
        `/api/nen-campaigns/columns?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    deliverColumn: (id: string, data: { accountId: string; scheduledAt?: string }) =>
      fetchApi<ApiResponse<{ queued: number }>>(`/api/nen-campaigns/columns/${encodeURIComponent(id)}/deliver`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    updateColumnMessage: (accountId: string, id: string, introText: string) =>
      fetchApi<{ success: boolean }>(`/api/nen-campaigns/columns/${encodeURIComponent(id)}/message?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'PUT', body: JSON.stringify({ introText }),
      }),
    pets: (accountId: string, search?: string) => {
      const query = new URLSearchParams({ lineAccountId: accountId })
      if (search) query.set('search', search)
      return fetchApi<ApiResponse<NenPetProfile[]>>(`/api/nen-campaigns/pets?${query}`)
    },
    createPet: (accountId: string, data: { friendId: string; customerId?: string; name: string; animalType: string; gender: string; birthday?: string }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/nen-campaigns/pets?lineAccountId=${encodeURIComponent(accountId)}`, { method: 'POST', body: JSON.stringify(data) }),
    updatePet: (accountId: string, id: string, data: { name: string; animalType: string; gender: string; birthday?: string }) =>
      fetchApi<{ success: boolean }>(`/api/nen-campaigns/pets/${encodeURIComponent(id)}?lineAccountId=${encodeURIComponent(accountId)}`, { method: 'PUT', body: JSON.stringify(data) }),
    deletePet: (accountId: string, id: string) => fetchApi<{ success: boolean }>(
      `/api/nen-campaigns/pets/${encodeURIComponent(id)}?lineAccountId=${encodeURIComponent(accountId)}`,
      { method: 'DELETE' },
    ),
    birthdayCoupon: (accountId: string) => fetchApi<ApiResponse<{
      isEnabled: boolean; codePrefix: string; benefitLabel: string; discountAmount: number; validityDays: number; updatedAt: string
    }>>(`/api/nen-campaigns/birthday-coupon?lineAccountId=${encodeURIComponent(accountId)}`),
    updateBirthdayCoupon: (accountId: string, data: { isEnabled: boolean; codePrefix: string; benefitLabel: string; discountAmount: number; validityDays: number }) =>
      fetchApi<{ success: boolean }>(`/api/nen-campaigns/birthday-coupon?lineAccountId=${encodeURIComponent(accountId)}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  nenMembers: {
    overview: () => fetchApi<ApiResponse<{ pets: number; healthLogs: number; activeCare: number; pendingPhotos: number; members: number; consultations: number }>>('/api/nen-members/overview'),
    careFlags: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/care-flags'),
    updateCareFlag: (id: string, data: { status: 'active' | 'resolved'; adviceReady: boolean }) => fetchApi<{ success: boolean }>(`/api/nen-members/care-flags/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    photos: (accountId: string) => fetchApi<ApiResponse<Array<Record<string, unknown>>>>(`/api/nen-members/photos?accountId=${encodeURIComponent(accountId)}`),
    reviewPhoto: (id: string, data: {
      accountId: string
      status: 'adopted' | 'rejected'
      reasonCode?: 'quality' | 'privacy' | 'unrelated' | 'duplicate' | 'other'
      reasonNote?: string
    }) => fetchApi<ApiResponse<{
      awardedPoints: number
      pointBalance: number | null
      pointSync: string
      notificationStatus: 'sent' | 'failed'
    }>>(`/api/nen-members/photos/${encodeURIComponent(id)}/review`, { method: 'PUT', body: JSON.stringify(data) }),
    retryPhotoReviewNotification: (id: string, accountId: string) => fetchApi<ApiResponse<{
      notificationStatus: 'sent'
    }>>(`/api/nen-members/photos/${encodeURIComponent(id)}/notification/retry`, {
      method: 'POST', body: JSON.stringify({ accountId }),
    }),
    friendOverview: (friendId: string) => fetchApi<ApiResponse<NenFriendOverview>>(`/api/nen-members/friends/${encodeURIComponent(friendId)}`),
    ranks: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/ranks'),
    consultations: () => fetchApi<ApiResponse<Array<Record<string, unknown>>>>('/api/nen-members/consultations'),
    installRichMenu: (accountId: string) => fetchApi<ApiResponse<{ richMenuId: string; liffId: string }>>('/api/nen-members/rich-menu/install', { method: 'POST', body: JSON.stringify({ accountId }) }),
  },
  chats: {
    list: (params?: { status?: string; operatorId?: string; accountId?: string; q?: string; unansweredOnly?: boolean; limit?: number; beforeAt?: string; beforeId?: string }) => {
      const query: Record<string, string> = {}
      if (params?.status) query.status = params.status
      if (params?.operatorId) query.operatorId = params.operatorId
      if (params?.accountId) query.lineAccountId = params.accountId
      if (params?.q) query.q = params.q
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
    update: (id: string, data: { operatorId?: string | null; status?: Chat['status']; notes?: string | null; revision?: number; reason?: string }) =>
      fetchApi<ApiResponse<Chat>>(`/api/chats/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    send: (id: string, data: { content: string; messageType?: string; revision?: number }, idempotencyKey: string) =>
      fetchApi<ApiResponse<{ sent: true; messageId: string; sentByStaffName: string; revision: number }>>(`/api/chats/${id}/send`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(data),
      }),
    markRead: (id: string) =>
      fetchApi<ApiResponse<{ isUnread: false }>>(`/api/chats/${id}/read`, {
        method: 'POST',
      }),
    markAllRead: () =>
      fetchApi<ApiResponse<{ marked: true }>>('/api/chats/read-all', {
        method: 'POST',
      }),
    events: (id: string) =>
      fetchApi<ApiResponse<Array<{
        id: string
        eventType: 'assignment' | 'status' | 'note' | 'read' | 'send' | 'conflict' | 'unsend'
        before: unknown
        after: unknown
        actorStaffId: string | null
        actorStaffName: string | null
        reason: string | null
        correlationId: string
        createdAt: string
      }>>>(`/api/chats/${id}/events`),
    savedViews: {
      list: (accountId: string) => fetchApi<ApiResponse<SavedSearch[]>>(`/api/inbox/saved-views?lineAccountId=${encodeURIComponent(accountId)}`),
      create: (accountId: string, data: { name: string; conditions: unknown; isShared?: boolean }) =>
        fetchApi<ApiResponse<SavedSearch>>(`/api/inbox/saved-views?lineAccountId=${encodeURIComponent(accountId)}`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, accountId: string, data: { name?: string; conditions?: unknown; isShared?: boolean }) =>
        fetchApi<ApiResponse<SavedSearch>>(`/api/inbox/saved-views/${id}?lineAccountId=${encodeURIComponent(accountId)}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      delete: (id: string, accountId: string) =>
        fetchApi<ApiResponse<null>>(`/api/inbox/saved-views/${id}?lineAccountId=${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
    },
  },
  reminders: {
    /** 161: 渡した順に並べ替える。見えているものだけ送る。 */
    reorder: (ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/reminders/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ ids }),
      }),
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Reminder[]>>('/api/reminders' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Reminder & { steps: ReminderStep[] }>>(`/api/reminders/${id}`),
    /** この友だちをこのリマインダに登録する（1人ぶん）。 */
    /**
     * 友だちをリマインダに登録する。
     *
     * targetDate はゴール日時（予約日・開催日）。**これが無いと登録できない。**
     * 以前は本文を送っておらず、worker 側が「targetDate is required」の手前で
     * 落ちて 500 を返していた。画面から一度も登録できていなかった。
     */
    enroll: (reminderId: string, friendId: string, targetDate: string) =>
      fetchApi<ApiResponse<unknown>>(
        `/api/reminders/${reminderId}/enroll/${friendId}`,
        { method: 'POST', body: JSON.stringify({ targetDate }) },
      ),
    create: (data: {
      name: string
      description?: string | null
      /** 新しいリマインダを動かすLINEアカウント。 */
      lineAccountId: string
      triggerType?: ReminderTriggerType
      triggerOffsetMinutes?: number | null
      sendAtTime?: string | null
      targetTagId?: string | null
      /** 156: フォルダ。null は未分類。 */
      folderId?: string | null
      /** 153: 'time'（○日前の●時）か 'countdown'（残り時間）。**作成後は変えられない。** */
      deliveryMode?: 'time' | 'countdown'
      /** 154: 友だち情報欄の日付を起点にするとき、見る欄。 */
      triggerFieldId?: string | null
      /** 154: 毎年くり返すか（誕生日なら true）。 */
      repeatYearly?: boolean
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
      > & {
        /** 156: フォルダ。null は未分類へ戻す。 */
        folderId?: string | null
      },
    ) =>
      fetchApi<ApiResponse<Reminder>>(`/api/reminders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${id}`, { method: 'DELETE' }),
    addStep: (
      id: string,
      data: {
        offsetMinutes: number
        messageType: string
        messageContent: string
        /** 153: ゴールから何日ずらすか。配信方式が 'time' のとき使う。 */
        offsetDays?: number | null
        /** 153: その日の何時に送るか（日本時間の "HH:MM"）。 */
        sendAtTime?: string | null
        /** 153: 送る中身をテンプレートから選ぶ。 */
        templateId?: string | null
      },
    ) =>
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
    history: (params: {
      accountId: string
      search?: string
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
    }, idempotencyKey: string) => fetchApi<ApiResponse<MileageAdjustmentResult>>('/api/mileage/adjustments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Confirm-Irreversible': 'mileage-adjustment',
      },
      body: JSON.stringify(data),
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
    saveDraft: (data: {
      accountId: string
      expectedDraftVersionId: string | null
      configuration: ActionScoreRuleBundle
    }) => fetchApi<ApiResponse<ActionScoreRuleConfiguration>>('/api/action-scores/rules/draft', {
      method: 'PATCH',
      body: JSON.stringify(data),
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
  },
  webhooks: {
    incoming: {
      list: (lineAccountId: string) =>
        fetchApi<ApiResponse<IncomingWebhook[]>>(
          `/api/webhooks/incoming?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      create: (data: { lineAccountId: string; name: string; sourceType?: string; secret: string }) =>
        fetchApi<ApiResponse<IncomingWebhookCreated>>('/api/webhooks/incoming', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, lineAccountId: string, data: Partial<Pick<IncomingWebhook, 'name' | 'sourceType' | 'isActive'>> & { secret?: string }) =>
        fetchApi<ApiResponse<IncomingWebhook>>(`/api/webhooks/incoming/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<null>>(
          `/api/webhooks/incoming/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
          { method: 'DELETE' },
        ),
    },
    outgoing: {
      list: (lineAccountId: string) =>
        fetchApi<ApiResponse<OutgoingWebhook[]>>(
          `/api/webhooks/outgoing?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      create: (data: { lineAccountId: string; name: string; url: string; eventTypes: string[]; secret: string; maxRetries?: number }) =>
        fetchApi<ApiResponse<OutgoingWebhookCreated>>('/api/webhooks/outgoing', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (
        id: string,
        lineAccountId: string,
        data: Partial<Pick<OutgoingWebhook, 'name' | 'url' | 'eventTypes' | 'isActive' | 'maxRetries'>> & { secret?: string },
      ) =>
        fetchApi<ApiResponse<OutgoingWebhook>>(`/api/webhooks/outgoing/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<null>>(
          `/api/webhooks/outgoing/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
          { method: 'DELETE' },
        ),
    },
    interactions: {
      list: (lineAccountId: string, params?: {
        periodDays?: number
        direction?: WebhookInteractionDirection
        status?: 'succeeded' | 'failed'
        search?: string
        page?: number
        limit?: number
      }) => {
        const query = new URLSearchParams({ lineAccountId })
        if (params?.periodDays) query.set('periodDays', String(params.periodDays))
        if (params?.direction) query.set('direction', params.direction)
        if (params?.status) query.set('status', params.status)
        if (params?.search) query.set('search', params.search)
        if (params?.page) query.set('page', String(params.page))
        if (params?.limit) query.set('limit', String(params.limit))
        return fetchApi<ApiResponse<WebhookInteractionList>>(`/api/webhooks/interactions?${query}`)
      },
      retry: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<WebhookInteraction>>(
          `/api/webhooks/interactions/${id}/retry?lineAccountId=${encodeURIComponent(lineAccountId)}`,
          { method: 'POST', body: '{}' },
        ),
      retryFailed: (lineAccountId: string) =>
        fetchApi<ApiResponse<{ requested: number; succeeded: number; failed: number; skipped: number }>>(
          `/api/webhooks/interactions/retry-failed?lineAccountId=${encodeURIComponent(lineAccountId)}`,
          { method: 'POST', body: '{}' },
        ),
    },
  },
  notifications: {
    center: {
      list: (lineAccountId: string, params?: { category?: 'all' | 'error' | 'update'; limit?: number }) => {
        const query = new URLSearchParams({ lineAccountId });
        if (params?.category) query.set('category', params.category);
        if (params?.limit !== undefined) query.set('limit', String(params.limit));
        return fetchApi<ApiResponse<NotificationCenterData>>(`/api/notifications/center?${query}`);
      },
      markRead: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<null>>(`/api/notifications/center/${id}/read`, {
          method: 'POST',
          body: JSON.stringify({ lineAccountId }),
        }),
      markAllRead: (lineAccountId: string, category?: 'all' | 'error' | 'update') =>
        fetchApi<ApiResponse<{ updated: number }>>('/api/notifications/center/read-all', {
          method: 'POST',
          body: JSON.stringify({ lineAccountId, category }),
        }),
    },
    rules: {
      list: (lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule[]>>(
          `/api/notifications/rules?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      get: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule>>(
          `/api/notifications/rules/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      create: (data: { lineAccountId: string; name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }) =>
        fetchApi<ApiResponse<NotificationRule>>('/api/notifications/rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, lineAccountId: string, data: Partial<Pick<NotificationRule, 'name' | 'eventType' | 'conditions' | 'channels' | 'isActive'>>) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...data, lineAccountId }),
        }),
      delete: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<null>>(
          `/api/notifications/rules/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
          { method: 'DELETE' },
        ),
    },
    list: (lineAccountId: string, params?: { status?: string; limit?: string }) =>
      fetchApi<ApiResponse<Notification[]>>(
        '/api/notifications?' + new URLSearchParams({ lineAccountId, ...params }),
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
    me: () => fetchApi<ApiResponse<StaffMember>>('/api/staff/me'),
    create: (data: { name: string; email: string; role: 'admin' | 'staff' | 'viewer'; permissionKeys?: string[]; notificationPreferences?: Record<string, { email: boolean; line: boolean }>; assignedLineAccountId: string; canAccessDescendantAccounts?: boolean; accountScope: 'all' | 'accounts'; scopedLineAccountIds?: string[]; managementContext?: 'hq' }) =>
      fetchApi<ApiResponse<StaffMember>>('/api/staff', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; email?: string | null; role?: string; isActive?: boolean; lineLinked?: false; permissionKeys?: string[]; notificationPreferences?: Record<string, { email: boolean; line: boolean }>; assignedLineAccountId?: string; canAccessDescendantAccounts?: boolean; accountScope?: 'all' | 'accounts'; scopedLineAccountIds?: string[]; managementContext?: 'hq' }) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    loginSummary: (id: string) =>
      fetchApi<ApiResponse<{ loginCount: number }>>(`/api/staff/${id}/login-summary`),
    delete: (id: string) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}`, { method: 'DELETE' }),
    regenerateKey: (id: string) =>
      fetchApi<ApiResponse<{ apiKey: string }>>(`/api/staff/${id}/regenerate-key`, { method: 'POST' }),
    beginTwoFactorSetup: (id: string) =>
      fetchApi<ApiResponse<{ provisioningUri: string; manualKey: string }>>(`/api/staff/${id}/two-factor/setup`, { method: 'POST' }),
    confirmTwoFactorSetup: (id: string, code: string) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}/two-factor/confirm`, { method: 'POST', body: JSON.stringify({ code }) }),
    disableTwoFactor: (id: string) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}/two-factor`, { method: 'DELETE' }),
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
        targetingCondition: string | null;
        targetingPriority: number;
        targetingEnabled: boolean;
        /** 159: フォルダ。分けていなければ null。 */
        folderId: string | null;
        /** 160: 自分で決める並び順。 */
        displayOrder: number;
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
        targetingCondition: string | null;
        targetingPriority: number;
        targetingEnabled: boolean;
        folderId: string | null;
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
          areas: RichMenuAreaResponse[];
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
        areas: RichMenuAreaPayload[];
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
      /** 出し分けの条件（SegmentCondition の JSON）。null で解除。 */
      targetingCondition?: string | null;
      targetingPriority?: number;
      targetingEnabled?: boolean;
      /** 159: フォルダ。null で未分類に戻す。 */
      folderId?: string | null;
      /** 160: 自分で決める並び順。 */
      displayOrder?: number;
      pages?: Array<{
        id?: string;
        name: string;
        orderIndex: number;
        areas: RichMenuAreaPayload[];
      }>;
    }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/rich-menu-groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    /** 押された回数。期間を省くとその月（日本時間）。 */
    tapStats: (accountId: string, range?: { from?: string; to?: string }) => {
      const params = new URLSearchParams({ accountId })
      if (range?.from) params.set('from', range.from)
      if (range?.to) params.set('to', range.to)
      return fetchApi<ApiResponse<RichMenuTapStats>>(
        `/api/rich-menu-groups/tap-stats?${params.toString()}`,
      )
    },

    deleteImpact: (groupId: string) =>
      fetchApi<ApiResponse<RichMenuDeleteImpact>>(
        `/api/rich-menu-groups/${groupId}/delete-impact`,
      ),

    delete: (groupId: string) =>
      fetchApi<ApiResponse<null>>(`/api/rich-menu-groups/${groupId}`, { method: 'DELETE' }),

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
      status?: IdentityCandidateStatus
      limit?: number
      offset?: number
    }) => {
      const query = new URLSearchParams({ kind: params.kind })
      if (params.status) query.set('status', params.status)
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
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
  },
  /**
   * 統合ユーザーの詳細（設計 `w8W4Eh` 3-3-A）。
   *
   * 更新は**読み込んだ `revision` を必ず送る**。先に別の人が変えていれば
   * Worker が 409 `STALE_PERSON` を返すので、画面は上書きせず読み直す。
   *
   * 結び付け・解除の口はここに無い。#598 の候補判定・取り消しを使う。
   */
  mergedPeople: {
    get: (id: string) =>
      fetchApi<ApiResponse<MergedPersonDetail>>(
        `/api/friends/people/${encodeURIComponent(id)}`,
      ),
    update: (id: string, body: UpdateMergedPersonRequest) =>
      fetchApi<ApiResponse<MergedPersonDetail>>(
        `/api/friends/people/${encodeURIComponent(id)}`,
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
  /** 緊急停止の影響（見るだけ）。止める・戻す口はまだ足していない。 */
  operations: {
    preview: (accountId: string | null) => {
      const query = accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''
      return fetchApi<ApiResponse<{
        control: OperationControl
        counts: Partial<Record<OperationCapability, number>>
        impact: OperationImpactPreview
        permissions: { canControl: boolean }
        calculatedAt: string
      }>>(`/api/operations/control/preview${query}`)
    },
  },
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

export interface BookingMenuStaff {
  id: string;
  display_name: string;
  role: string | null;
  profile_image_url: string | null;
  bio: string | null;
  is_designation_optional: number;
  price: number;
  duration_minutes: number;
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

export interface BookingAvailabilitySlot {
  date: string;
  start: string;
  end: string;
}

export interface BookingAvailabilityResponse {
  by_staff: Array<{
    staff_id: string;
    display_name: string;
    slots: BookingAvailabilitySlot[];
  }>;
}

export interface ProxyBookingResult {
  booking_id: string;
  status: string;
  calendar_sync: 'not_configured' | 'synced' | 'failed' | 'pending';
  replayed?: boolean;
}

function withAccount(path: string, accountId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}account_id=${encodeURIComponent(accountId)}`;
}

export const bookingApi = {
  // Menus
  listMenus: (accountId: string) =>
    fetchApi<{ menus: BookingMenu[] }>(withAccount('/api/booking/admin/menus', accountId)),
  listMenuStaff: (accountId: string, menuId: string) =>
    fetchApi<{ staff: BookingMenuStaff[] }>(
      withAccount(`/api/booking/admin/menus/${menuId}/staff`, accountId),
    ),
  getAvailability: (
    accountId: string,
    params: { menuId: string; staffId?: string; from: string; to: string },
  ) => {
    const query = new URLSearchParams({
      account_id: accountId,
      menu_id: params.menuId,
      from: params.from,
      to: params.to,
    });
    if (params.staffId) query.set('staff_id', params.staffId);
    return fetchApi<BookingAvailabilityResponse>(`/api/booking/admin/availability?${query}`);
  },
  createProxyBooking: (
    accountId: string,
    body: {
      friend_id: string;
      menu_id: string;
      staff_id: string;
      starts_at: string;
      customer_note?: string;
    },
    idempotencyKey: string,
  ) =>
    fetchApi<ProxyBookingResult>(withAccount('/api/booking/admin/bookings', accountId), {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
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
  ) => (async () => {
    const items: EventSlot[] = []
    for (let offset = 0; offset < slots.length; offset += 400) {
      const chunk = slots.slice(offset, offset + 400)
      try {
        const response = await fetchApi<{ items: EventSlot[] }>(
          withAccount(`/api/events/admin/events/${eventId}/slots`, accountId),
          { method: 'POST', body: JSON.stringify({ slots: chunk }) },
        )
        items.push(...response.items)
      } catch (error) {
        const detail = error instanceof Error ? `（${error.message}）` : ''
        throw new Error(`${items.length}件まで追加されました。残りを確認してから、もう一度追加してください${detail}`, { cause: error })
      }
    }
    return { items }
  })(),
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

export type WebinarNotificationSettings = {
  webinarId: string
  version: number
  registrationEnabled: boolean
  dayBeforeEnabled: boolean
  dayBeforeTime: string
  hourBeforeEnabled: boolean
  hourBeforeMinutes: number
  startEnabled: boolean
  missedEnabled: boolean
  missedTime: string
  completedEnabled: boolean
  updatedAt: string
}

export type WebinarNotificationSettingsInput = Omit<
  WebinarNotificationSettings,
  'webinarId' | 'version' | 'updatedAt'
>

export type WebinarNotificationOverview = {
  total: number
  pending: number
  sent: number
  failed: number
  skipped: number
  cancelled: number
}

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
  list: (accountId?: string) => fetchApi<{ data: Webinar[] }>(
    `/api/webinars${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`,
  ),
  get: (id: string) => fetchApi<{ data: Webinar }>(`/api/webinars/${id}`),
  create: (input: WebinarInput) =>
    fetchApi<{ data: Webinar }>('/api/webinars', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: WebinarInput) =>
    fetchApi<{ data: Webinar }>(`/api/webinars/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: string) => fetchApi<{ data: null }>(`/api/webinars/${id}`, { method: 'DELETE' }),
  notifications: (id: string) => fetchApi<{
    data: {
      settings: WebinarNotificationSettings | null
      overview: WebinarNotificationOverview
    }
  }>(`/api/webinars/${id}/notifications`),
  saveNotifications: (id: string, input: WebinarNotificationSettingsInput) => fetchApi<{
    data: {
      settings: WebinarNotificationSettings
      queued: number
      cancelled: number
    }
  }>(`/api/webinars/${id}/notifications`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }),
  testNotifications: (id: string) => fetchApi<{
    data: { sent: number; failed: number }
  }>(`/api/webinars/${id}/notifications/test`, { method: 'POST' }),
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
