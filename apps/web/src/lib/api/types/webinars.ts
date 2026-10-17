import type { Folder } from '@line-crm/shared'

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
  /**
   * 動画の選択元メディアID。保存値 videoPrefix は選んだメディアの
   * r2_key からサーバーが生成する。ライブラリ外の prefix なら null。
   * 保存時にこちらを送ると videoPrefix より優先され、両方は送れない。
   */
  videoMediaId?: string | null
  durationSeconds: number
  schedule: WebinarScheduleRule[]
  cta: { label: string; url: string; showAtSeconds: number } | null
  tagOnAttend: string | null
  tagOnCtaClick: string | null
  folderId?: string | null
  publicationState?: 'period' | 'always' | 'scheduled' | 'ended' | 'unset' | null
  publicationStartsAt?: string | null
  publicationEndsAt?: string | null
  createdAt: string
  updatedAt: string
}

export type WebinarListItem = Webinar & {
  folderName: string | null
  registrationCount: number
  viewerCount: number | null
}

export type WebinarFolder = Folder & { accountId: string; count: number }

export type WebinarInput = Partial<Omit<Webinar, 'id' | 'createdAt' | 'updatedAt'>> & {
  deliveryKind?: 'on_demand' | 'scheduled' | 'external'
  viewingCondition?: { kind: string; label: string }
  publicDescription?: string
  registrationFormId?: string | null
  expectedVersion?: number
}

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
  /** 見逃し配信の期限（開催からの日数。1〜30、既定7）。N。 */
  missedWindowDays: number
  completedEnabled: boolean
  updatedAt: string
}

export type WebinarNotificationSettingsInput = Omit<
  WebinarNotificationSettings,
  'webinarId' | 'version' | 'updatedAt' | 'missedWindowDays'
> & {
  missedWindowDays?: number
}

export type WebinarVideoAsset = {
  id: string
  stage: 'uploaded' | 'inspecting' | 'converting' | 'packaging' | 'thumbnail' | 'ready' | 'failed'
  stageLabel: string
  provider: string
  durationSeconds: number
  errorCode: string | null
  expiresAt: string | null
  purgedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WebinarSessionCapacity = {
  sessionStartAt: number
  capacity: number | null
  reservedCount: number
  state: 'open' | 'full' | 'closed'
  remaining: number | null
}

export type WebinarSkipReasonCount = {
  /** 記録された理由の符号。古い行では null のことがある。 */
  code: string | null
  /** 画面に出す日本語。 */
  label: string
  count: number
}

export type WebinarNotificationOverview = {
  total: number
  pending: number
  sent: number
  failed: number
  skipped: number
  cancelled: number
  /**
   * 見送りの内訳（#745）。
   *
   * 「見送り 5件」だけでは、**視聴済みだから送らなかった**（正常）のか、
   * **対象回が終了済みで落ちた**（もう取り戻せない）のかが分かりません。
   */
  skippedReasons: WebinarSkipReasonCount[]
  audience: {
    people: number
    bookings: number
    definition: 'active_registrations'
  }
}

export type WebinarOverviewMetric = {
  value: number | null
  state: 'available' | 'unavailable'
  reason: string | null
}

export type WebinarOverview = {
  state: 'partial'
  registrationMode: 'people'
  metrics: {
    webinars: WebinarOverviewMetric
    activeWebinars: WebinarOverviewMetric
    registrations: WebinarOverviewMetric
    registrationBookings: WebinarOverviewMetric
    viewers: WebinarOverviewMetric
    viewRate: WebinarOverviewMetric
    averageWatchSeconds: WebinarOverviewMetric
    ctaUniquePeople: WebinarOverviewMetric
    ctaTotalClicks: WebinarOverviewMetric
  }
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
  viewSegments?: Array<{ startSeconds: number; endSeconds: number; viewers: number }>
  measurement?: { state: 'available' | 'unavailable'; reason: string | null }
  /** J-1「どこまで見られたか」の線と3つの数字の材料。 */
  retention: {
    bucketSeconds: number
    started: number
    points: Array<{ atSeconds: number; viewers: number }>
  }
  /** 有効な区間の合計30秒以上の人数。 */
  startedViewers: number
  /** 異常として除外した heartbeat の件数。 */
  heartbeatRejects: number
  /** 申し込みボタンが出た時刻（秒）。CTAが無ければ null。 */
  ctaAtSeconds: number | null
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

export type WebinarAction = {
  id?: string
  trigger: 'completed' | 'cta_clicked' | 'unviewed'
  actionType: 'add_tag' | 'remove_tag' | 'start_scenario' | 'stop_scenario' | 'resume_scenario' | 'send_message' | 'send_webhook' | 'switch_rich_menu' | 'remove_rich_menu'
  config: Record<string, unknown>
  position?: number
  version?: number
}

export type WebinarEditor = {
  version: number
  deliveryKind: 'on_demand' | 'scheduled' | 'external'
  viewingCondition: { kind: string; label: string }
  publicDescription: string
  registrationFormId: string | null
  /* カード方式のCTAの件数。段の印・最終確認はこれを見る。 */
  ctaCount: number
  notificationMessages: Record<string, string>
  notificationTest: { status?: string; sent?: number; failed?: number; testedAt?: string } | null
  actionPolicy: {
    templateBody: string
    missingResultPolicy: 'escalate' | 'retry_next_day'
  }
  publicPage: {
    liffId: string | null
    url: string | null
    unavailableReason: string | null
    description: string
    test: { status?: string; testedAt?: string } | null
    form: {
      id: string
      name: string
      active: boolean
      fields: string[]
      completionActions: string[]
    } | null
  }
  publication: {
    status: Webinar['status']
    draftVersion: number
    publishedVersion: number | null
    publishedAt: string | null
  }
  monitoring: {
    notificationFailures: number
    duplicateRegistrations: number
    viewSegmentFailures: number
    actionFailures: number
  }
  /** 同時編集の見分けに使う、読んだときの更新日時。無い口では undefined。 */
  updatedAt?: string | null
}

export type WebinarPublishValidation = {
  version: number
  checks: Array<{
    key: string
    label: string
    status: 'passed' | 'warning' | 'failed'
    detail: string | null
  }>
  blockers: string[]
  warnings: string[]
}

export type WebinarParticipantClassification = 'unviewed' | 'dropped_off' | 'completed' | 'unmeasured'

export type WebinarParticipantPage = {
  items: Array<{
    friendId: string
    friendName: string | null
    pictureUrl: string | null
    sessions: number
    firstJoinedAt: string | null
    latestJoinedAt: string | null
    maxWatchedSeconds: number
    ctaClickedAt: string | null
    registered: boolean
    formSubmittedAt: string | null
    actionStatus: string | null
    errorDetail: string | null
    staffIntegrationStatus: 'completed' | 'needs_attention' | 'pending'
    /* 分類・ライブ/録画の区別はサーバー側の一つのルールで決める。
       古い応答には無いので、無いときは画面側の推測へ落とす。 */
    classification?: WebinarParticipantClassification
    liveSessions?: number
    replaySessions?: number
    lastJoinKind?: 'live' | 'replay' | null
  }>
  nextCursor: string | null
  measurement?: { state: 'available' | 'unavailable'; reason: string | null }
  rule?: { completionThresholdSeconds: number; durationSeconds: number }
}

export type WebinarListParams = {
  page?: number
  limit?: number
  q?: string
  folder?: string
  status?: 'active' | 'draft' | 'archived'
  sort?: 'updated' | 'created' | 'name'
}

export type WebinarListResponse = {
  items: WebinarListItem[]
  total: number
  limit: number
  sort: Array<{ field: string; direction: 'asc' | 'desc' }>
}
