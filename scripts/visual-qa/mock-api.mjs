/**
 * 画面確認だけのための、Workerの代わりになる小さなAPI。
 *
 * 管理画面は `AuthGuard` が `/api/auth/session` を見に行き、失敗すると
 * `/login` へ飛ぶ。そのため本物のWorkerとD1が無いとローカルで1画面も
 * 見られなかった。ここが無い間、PRは「画面を見ないまま」積まれていた。
 *
 * これは本物の代わりではない。**空の状態**を全画面で描かせるためのもの。
 *
 * 守っていること
 * - ローカル専用。`NODE_ENV=production` では起動しない。127.0.0.1 にだけ開く
 * - **保存と配信は必ず失敗させる。** 405。数えるだけの POST（配信前チェック）だけ通す。
 *   ただし CORS では通す（`Allow-Methods` に書き込みも並べる）。ブラウザ側で
 *   弾くと、**画面が要求を出したのかどうかすら見えない。** 405 まで届かせて、
 *   画面が失敗をどう出すかを撮る
 * - 実データ・秘密値を持たない。名前も固定の作り物
 * - 毎回まったく同じものを返す。乱数も時刻も使わない（画像が毎回同じになる）
 *
 * 使い方
 *   node scripts/visual-qa/mock-api.mjs            # 既定 8788番
 *   PORT=9000 node scripts/visual-qa/mock-api.mjs
 */
import { createServer } from 'node:http'
import { readArrayGetPaths } from './api-shapes.mjs'
import {
  ACTION_SCORES,
  ACTION_SCORE_BANDS,
  ACTION_SCORE_RULE_CONFIG,
  AD_CONVERSION_LOGS,
  AD_PLATFORMS,
  AFFILIATES,
  AFFILIATES_REPORT,
  AFFILIATE_JOURNEYS,
  AFFILIATE_LINKS,
  AFFILIATE_OFFERS,
  AFFILIATE_PAYMENTS,
  AFFILIATE_PAYMENTS_EMPTY,
  AFFILIATE_PAYMENT_PERIODS,
  AFFILIATE_PAYMENT_PERIODS_EMPTY,
  AFFILIATE_REPORT_V2,
  ANALYTICS_BROADCASTS,
  ANALYTICS_CROSS,
  ANALYTICS_FRIENDS,
  ANALYTICS_FUNNEL_DEFS,
  ANALYTICS_FUNNEL_RUN,
  ANALYTICS_MESSAGES,
  ANALYTICS_REACTIONS,
  ANALYTICS_ROUTES,
  ANALYTICS_TRACKED_LINKS,
  ANALYTICS_URL_CLICKS,
  ANALYTICS_USAGE,
  AUTOMATIONS,
  AUTOMATION_LOGS,
  AUTOMATION_RUNS,
  AUTOMATION_TEMPLATES,
  AUTO_REPLIES,
  AUTO_REPLY_CONFLICTS,
  AUTO_REPLY_DRAFT,
  AUTO_REPLY_DRAFT_UNTESTED,
  AUTO_REPLY_DRY_RUN,
  AUTO_REPLY_DRY_RUN_LOST,
  AUTO_REPLY_FOLDERS,
  AUTO_REPLY_PUBLISHED,
  AUTO_REPLY_RUNS,
  AUTO_REPLY_VALIDATION,
  AUTO_REPLY_VALIDATION_OK,
  BOOKING_MENUS,
  BOOKING_MENU_STAFF,
  BOOKING_REQUESTS,
  BOOKING_STAFF,
  BOOKING_TAKEN_SLOT,
  BROADCASTS,
  BROADCAST_FOLDERS,
  BROADCAST_MESSAGE_ASSETS,
  BROADCAST_STATS,
  CHATS,
  COMMON_ACTIONS,
  COMMON_VARS,
  COMMON_VAR_FOLDERS,
  COMMON_VAR_IMPACT,
  COMMON_VAR_SCHEDULES,
  CONVERSION_APPROVALS,
  CONVERSION_POINTS,
  CONVERSION_POINT_IMPACTS,
  DUPLICATE_STATS,
  EC_EVENTS,
  EC_NOTIFICATION_FAILURES,
  EC_NOTIFICATION_RUNS,
  EC_OVERVIEW,
  EC_SETTINGS,
  ENTRY_ROUTES,
  ENTRY_ROUTE_GENRES,
  EVENTS,
  EVENT_BOOKINGS,
  FORMS,
  FORM_LAYOUT_VISIT,
  FORM_SUBMISSIONS,
  FRIENDS,
  FRIEND_ADD_BREAKDOWN,
  FRIEND_ADD_EVENTS,
  FRIEND_ADD_LIFECYCLE_DRAFT,
  FRIEND_ADD_LIFECYCLE_EMPTY,
  FRIEND_ADD_LIFECYCLE_ERROR,
  FRIEND_ADD_LIFECYCLE_PUBLISHED,
  FRIEND_ADD_LIFECYCLE_TEST_RESULT,
  FRIEND_ADD_LIFECYCLE_VALIDATION,
  FRIEND_ADD_ROUTING,
  FRIEND_DETAILS,
  FRIEND_FIELDS,
  FRIEND_FIELD_SUMMARY,
  FRIEND_MESSAGES,
  FRIEND_MILEAGE,
  FRIEND_SCENARIOS,
  FRIEND_STATS,
  IDENTITY_CANDIDATE_EC,
  IDENTITY_CANDIDATE_ERROR,
  IDENTITY_CANDIDATE_FRIEND,
  IDENTITY_CANDIDATE_LISTS,
  INBOX_SAVED_VIEWS,
  INBOX_STATS,
  INCOMING_WEBHOOKS,
  INTEGRATION_RECORDS,
  LIST_STATS,
  LOGIN_AUDIT,
  MEDIA_FOLDERS,
  MEDIA_ITEMS,
  MEDIA_USAGE,
  MERGED_PERSON_DETAIL,
  MERGED_PERSON_EMPTY,
  MERGED_PERSON_ERROR,
  MILEAGE_HISTORY,
  MILEAGE_OVERVIEW,
  MILEAGE_REWARDS,
  MILEAGE_RULES,
  NEN_CAMPAIGN_SETTINGS,
  NEN_COLUMNS,
  NEN_COLUMN_DRAFT,
  NEN_JOBS,
  NEN_OVERVIEW,
  NEN_PETS,
  NEN_PHOTOS,
  NOTIFICATION_CENTER,
  NOTIFICATION_RULES,
  OPERATION_CONTROL_PREVIEW,
  OPERATION_CONTROL_PREVIEW_ONE,
  OPERATORS,
  OUTGOING_WEBHOOKS,
  QUESTION_TEMPLATE_DRAFT,
  QUESTION_TEMPLATE_PUBLISHED,
  REF_SUMMARY,
  REMINDERS,
  REMINDER_DRAFT,
  REMINDER_FOLDERS,
  REMINDER_PREVIEW,
  REMINDER_PUBLISHED,
  REMINDER_RUNS,
  REMINDER_VALIDATION,
  RICH_MENU_DELETE_IMPACT,
  RICH_MENU_DELETE_IMPACT_EMPTY,
  RICH_MENU_DELETE_IMPACT_ERROR,
  RICH_MENU_EXTERNAL,
  RICH_MENU_FOLDERS,
  RICH_MENU_GROUPS,
  RICH_MENU_GROUP_DETAILS,
  RICH_MENU_TAP_STATS,
  SAVED_ANALYTICS,
  SAVED_ANALYTICS_SNAPSHOTS,
  SAVED_SEARCHES,
  SCENARIO_STATS,
  SCENARIO_STEPS,
  SEGMENT_PRESETS,
  STAFF_MEMBERS,
  SUPPORT_MARKS,
  TAGS,
  TAG_GROUPS,
  TEMPLATES,
  TEMPLATE_FOLDERS,
  USERS_GROUPED,
  WEBINARS,
  WEBINAR_ANALYTICS,
  WEBINAR_NOTIFICATIONS,
  bookingAvailability,
  testActionScoreRules,
} from './fixtures.mjs'

if (process.env.NODE_ENV === 'production') {
  console.error('[visual-qa] 本番では起動しない。画面確認専用のため。')
  process.exit(1)
}

const PORT = Number(process.env.PORT ?? 8788)
const HOST = '127.0.0.1'

/** 画面を見るだけなので、いちばん権限のある人で固定する。実在しない名前。 */
const STAFF = {
  id: 'visual-qa-owner',
  name: '画面確認',
  role: 'owner',
  readOnly: false,
  permissionKeys: [],
  assignedLineAccountId: null,
  canAccessDescendantAccounts: true,
  tenantId: null,
}

/**
 * LINEアカウントが1つも無いと、どの画面も「店舗が選ばれていません」で
 * 止まり、中身が描けない。**1件だけ**固定で置く。値はすべて作り物で、
 * 秘密値は持たない（`*Configured` は true にするが、値そのものは無い）。
 */
const ACCOUNT = {
  id: 'visual-qa-account',
  channelId: '0000000000',
  name: '画面確認アカウント',
  channelAccessTokenConfigured: true,
  channelSecretConfigured: true,
  loginChannelId: null,
  loginChannelSecretConfigured: false,
  liffId: null,
  isActive: true,
  friendCapacity: null,
  capacityWarnAt: null,
  iconUrl: null,
}

/**
 * 画面ごとに欲しい形が違う。`items` も `total` も持つ器を既定にし、
 * 配列を直接読む先だけ配列で返す（配列にすると `data.items` を読む画面が
 * 落ちるため、混ぜられない）。
 */
const EMPTY_PAGE = { items: [], total: 0, page: 1, limit: 20 }

/* 保存したひな形と、送られてきた本文（撮影中だけ持つ）。 */
const SAVED_TEMPLATES = new Map()
const SAVED_BODIES = []

/** 期間の端。**時計を読まない**（読むと画像が毎回変わる）。 */
const FIXED_FROM = '2026-01-01'
const FIXED_TO = '2026-01-13'

/**
 * ダッシュボードの器（`DashboardOverview`）。
 *
 * 数はすべて0。**「取れなかった」ではなく「0件」として描かせる**ための器で、
 * ここに嘘の実績を入れない。`trend` は空配列のままにする（作り物の折れ線を
 * 入れると、動いていない画面を動いていると読み違える）。
 */
/**
 * ダッシュボードの中身。**設計 `★ V6 1-1` `vUXKb` に書いてある値そのまま。**
 *
 * 全部0で返していたあいだ、ダッシュボードは空の絵しか描けなかった。
 * 受信の表もページ送りも送信枠の帯も出ないので、**設計と並べても
 * 「差が無い」とは言えない**（そもそも比べる中身が無い）。
 *
 * 設計の絵から取った値
 * - 対応が必要な受信 5件（LINE 1・MAIL 4）、最も古い未対応 9,110分前
 * - 今月の送信枠 197 / 200通（残り98.5%）→ 上限200・使用3
 * - 友だち総数 621人・有効 398人・ブロック 223人（35.9%）
 * - 友だち数の推移 7日ぶん。8/13だけ登録1で流入元「検索」
 *
 * **設計の中で数が食い違っている箇所がある。** 「接続状態」の有効友だちは
 * 4人だが、「友だちの状態」の有効は398人。同じ `friends.active` から出る
 * ので、両方は描けない。ここは398で返し、突き合わせ文書に書いてある。
 */
const DASHBOARD_TREND = [
  ['2026-08-13', 1, 0, 4, [{ name: '検索', count: 1 }]],
  ['2026-08-14', 0, 0, 4, []],
  ['2026-08-15', 0, 0, 4, []],
  ['2026-08-16', 0, 0, 4, []],
  ['2026-08-17', 0, 0, 4, []],
  ['2026-08-18', 0, 0, 4, []],
  ['2026-08-19', 0, 0, 4, []],
].map(([date, added, blocked, active, sources]) => ({
  date, added, blocked, active, estimated: false, sources,
}))

/**
 * 表示するカードと並び。設計 `vUXKb` の右カラムに合わせる。
 * 既定では出ない「友だちの状態」も、設計の絵では出ているので出す。
 */
const DASHBOARD_PREFERENCES = {
  source: 'account-default',
  version: 1,
  updatedAt: `${FIXED_TO}T00:00:00.000Z`,
  cards: {
    today: ['today-inbox', 'today-photo-review', 'today-bookings', 'today-shipments']
      .map((id) => ({ id, visible: true })),
    main: [
      ...['shipment', 'pending-inbox', 'friend-trend', 'friend-add'].map((id) => ({ id, visible: true })),
      ...['scenario-status', 'uid-migration'].map((id) => ({ id, visible: false })),
    ],
    right: [
      ...['send-quota', 'operational-alerts', 'connection-status', 'support-mark-status',
        'friend-status', 'upcoming', 'monthly-delivery', 'recent-results'].map((id) => ({ id, visible: true })),
      ...['booking-status', 'inflow-top', 'funnel-alert', 'automation-failures'].map((id) => ({ id, visible: false })),
    ],
  },
}

const DASHBOARD_OVERVIEW = {
  period: 'today',
  generatedAt: `${FIXED_TO}T00:00:00.000Z`,
  friends: { active: 398, total: 621, blockedByThem: 223, hiddenByUs: 0, blockedBoth: 0 },
  inbox: {
    unanswered: 5,
    inProgress: 0,
    resolved: 38,
    // 設計の運用アラート「最も古い未対応：9,110分前」。
    oldestUnansweredMinutes: 9110,
    averageFirstReplyMinutes: null,
  },
  // 設計「プッシュ 0通 リプライ 0通」「197 / 200通（残り98.5%）」。
  delivery: { sent: 0, push: 0, reply: 0, broadcasts: 0, quotaLimit: 200, quotaUsed: 3 },
  trend: DASHBOARD_TREND,
  conversions: { total: 0, byPoint: [] },
  partialFailures: [],
  operations: {
    scenarios: { active: 0, paused: 0 },
    migrations: { active: 0, completed: 0 },
    bookings: { pending: 0, upcoming: 0 },
    inflowTop: [],
    funnelAlerts: 0,
    automationFailures: 0,
  },
}

/**
 * 対応が必要な受信。設計の表の2行そのまま。**総数は5件**なので、
 * ページ送りが「1〜2 / 5件」と2ページ出る。1ページに収まる数で返すと、
 * ページ送りが描かれず、そこを見張れない。
 */
const SUPPORT_INBOX_ITEMS = [
  {
    id: 'inbox-1',
    channel: 'line',
    customerName: 'Kyohei Yamamoto',
    preview: '🚕💐',
    // 「6日前」と出したい。撮るときの時計は `VISUAL_QA_NOW` で止めてある。
    lastIncomingAt: '2026-08-13T12:00:00.000Z',
  },
  {
    id: 'inbox-2',
    channel: 'email',
    customerName: 'テスト 太郎',
    preview: 'テスト太郎 様 この度…',
    // 「4日前」。
    lastIncomingAt: '2026-08-15T12:00:00.000Z',
  },
]

/**
 * 受信箱（`/chats`）に混ぜるメール。ダッシュボードの行とは別の形が要る。
 * `status` が無いと `statusConfig[item.status]` で落ちる。
 */
const SUPPORT_EMAIL_ITEMS = [
  {
    id: 'email:mail-1',
    threadId: 'mail-1',
    customerName: '坂本 真人',
    customerIdentifier: 'sakamoto@example.com',
    subject: '発送について',
    preview: 'ご注文ありがとうございます。発送状況をご案内します。',
    status: 'unread',
    revision: 1,
    assignedStaffId: null,
    assignedStaffName: null,
    lastIncomingAt: '2026-08-16T02:10:00.000Z',
    isUnread: true,
  },
  {
    id: 'email:mail-2',
    threadId: 'mail-2',
    customerName: 'テスト 太郎',
    customerIdentifier: 'taro@example.com',
    subject: 'ご注文について',
    preview: 'ご注文ありがとうございます。内容を確認して対応します。',
    status: 'unread',
    revision: 1,
    assignedStaffId: null,
    assignedStaffName: null,
    lastIncomingAt: '2026-08-16T01:30:00.000Z',
    isUnread: true,
  },
]

/**
 * 一覧を配列で返す口。**`api.ts` から読む。手で並べない。**
 *
 * 手で並べていたときは6件しか無く、足りない口が `{items:[],total:0}` に
 * 落ちて、ダッシュボード・分析・一斉配信・リッチメニュー・
 * オートメーションの5画面が `xxx.filter is not a function` で真っ白だった。
 */
const ARRAY_PATHS = readArrayGetPaths()

/**
 * `api.ts` を通らない口。**足すのは、落ちた画面を見てから。**
 *
 * 受信箱の担当者一覧は `api.ts` に無く、自動では拾えない。
 * 消したら `operators.map is not a function` で受信箱が真っ白になった。
 */
for (const extra of ['/api/operators', '/api/feature-settings']) ARRAY_PATHS.add(extra)

/**
 * 後ろが変わる口（`/api/scenarios/{id}/steps` など）。
 * ここは `api.ts` から機械的には決められないので、**落ちた画面を見て足す**。
 */
const ARRAY_PREFIXES = [
  '/api/scenarios/',
  '/api/automations/',
  '/api/media/',
  '/api/common-vars/',
  '/api/entry-routes/',
  '/api/affiliates/',
  '/api/traffic-pools/',
  '/api/ad-platforms/',
  '/api/users/',
]

/** 機能のオン／オフ。全部オンにして、どの画面も出るようにする。 */
const FEATURE_KEYS = [
  'scenarios', 'broadcasts', 'templates', 'reminders', 'auto_replies',
  'rich_menus', 'webinars', 'inflow_tracking', 'forms', 'mileage',
  'affiliates', 'analytics', 'media', 'events', 'booking', 'automations',
  'external_integrations', 'friend_add_routing', 'nen_campaigns',
  'photo_review', 'ec_commerce', 'line_notifications', 'restaurant_test',
]
const FEATURES = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]))

/**
 * パスごとの形。ここに無いものは `EMPTY_PAGE` になる。
 *
 * 画面が増えて足りなくなったら、ここに1行足す。**推測で埋めない。**
 * 実際に落ちた画面のコンソールを見て、必要な形だけを足す。
 */
const SHAPES = {
  '/api/public/brand': { name: '画面確認アカウント', iconUrl: null },
  '/api/settings/features': {
    features: FEATURES,
    sidebarOrder: null,
    sidebarItemOrder: null,
    parentChildMode: false,
    /*
      **専用機能の鍵を渡す。** 空だと `visibleFeatureGroups` が
      「専用機能」「飲食店向け（テスト）」の区分をまるごと隠すので、
      機能設定の画面が設計より短く撮れ、**実装に無いように見える。**
    */
    specializedFeatureKeys: [
      'nen_campaigns', 'photo_review', 'ec_commerce', 'line_notifications', 'restaurant_test',
    ],
  },
  '/api/inbox/unanswered/count': { total: 0, byAccount: [], oldestWaitMinutes: null },
  // 設計 `vUXKb` の「写真審査 1件 確認待ち」。0で返すとカードが空のまま撮れる。
  '/api/nen-members/overview': { pets: 0, healthLogs: 0, activeCare: 0, pendingPhotos: 1, members: 0, consultations: 0 },
  '/api/mileage/rewards': MILEAGE_REWARDS,
  '/api/broadcasts/stats': BROADCAST_STATS,
  '/api/login-audit': LOGIN_AUDIT,
  '/api/friends/stats': FRIEND_STATS,
  '/api/friends': { items: FRIENDS, total: 231, page: 1, limit: 20 },
  '/api/operators': OPERATORS,
  '/api/scenarios': FRIEND_SCENARIOS,

  /* 予約。`api.ts` を通らない口なので、読む側（`app/page.tsx`）に合わせる。 */
  '/api/booking/admin/requests': { requests: [] },

  /* EC の出荷予定（`EcShipmentList`）。`soon`/`later` は配列で要る。 */
  '/api/ec-commerce/shipments': {
    today: FIXED_TO,
    tomorrow: '2026-01-14',
    soon: [],
    later: [],
    soonCount: 0,
    laterCount: 0,
    scanned: 0,
    scanLimit: 0,
  },

  /*
   * ダッシュボード（`DashboardOverview`）。**入れ子の数まで置く。**
   * `friends` や `inbox` を欠くと `undefined.toLocaleString()` で
   * 画面ごと落ちる。日付は固定（毎回同じ画像にするため）。
   */
  '/api/dashboard/overview': DASHBOARD_OVERVIEW,
  '/api/dashboard/organization-overview': DASHBOARD_OVERVIEW,

  /* リッチメニュー。LINE側にある実物の一覧と、押された回数。 */
  '/api/rich-menu-groups/external': { currentDefault: null, lineMenus: [] },
  '/api/rich-menu-groups/tap-stats': { from: FIXED_FROM, to: FIXED_TO, byArea: [], byGroup: [], total: 0 },

}

/** `success` の器に入れず、そのまま返すもの。 */
const RAW = {
  // `0.0.0-dev` のときはバナー自体を出さない。manifest も見に行かない。
  //（update-banner.tsx の DEV_VERSION と同じ値でないと効かない）
  '/admin/version': { version: '0.0.0-dev', worker_hash: '', admin_hash: '', liff_hash: '' },
  '/admin/manifest': { releases: [], versions: [] },
}

/** 参照が1つも無ければ消せる（`packages/db` の `canDelete` と同じ数え方）。 */
function tagDeleteImpact(tag) {
  const used = tag.usedIn ?? {}
  const references = {
    broadcasts: used.broadcasts ?? 0,
    forms: used.forms ?? 0,
    scenarios: used.scenarios ?? 0,
    autoReplies: used.autoReplies ?? 0,
    savedSearches: used.savedSearches ?? 0,
    automations: 0,
    commonActions: 0,
    richMenus: 0,
    templates: 0,
    webinars: 0,
    reminders: 0,
    entryRoutes: 0,
    trackedLinks: 0,
    bookingMenus: 0,
    affiliateOffers: 0,
    events: 0,
    analyticsFunnels: 0,
    friendAddSettings: 0,
  }
  const blockingReferenceCount = Object.values(references).reduce((sum, n) => sum + n, 0)
  return {
    tag: { id: tag.id, name: tag.name },
    friendCount: tag.friendCount ?? 0,
    references,
    blockingReferenceCount,
    canDelete: blockingReferenceCount === 0,
  }
}

/**
 * リマインダの通知ステップ。**一覧の既定の形（`{items,…}`）では返さない。**
 * 編集画面は `steps` を配列として回すので、通で返さないとそこで落ちる。
 */
/** 中身の無いフォームの下敷き。`FormLayout` の4つの持ち物をすべて埋める。 */
function emptyFormLayout(form) {
  return {
    version: 2,
    header: [],
    sections: [{
      id: `s_${form.id}`,
      name: 'セクション1',
      blocks: form.fields.map((field, i) => ({
        id: `b_${form.id}_${i}`,
        kind: 'input',
        type: field.type ?? 'text',
        name: field.name,
        label: field.label,
      })),
    }],
    options: {
      thanksText: 'ご回答ありがとうございました。',
      submitLabel: '送信', prevLabel: '前へ', nextLabel: '次へ',
      sectionHeader: 'pageNumber',
      confirmDialog: { enabled: false }, deadline: { enabled: false },
      oncePerFriend: { enabled: false }, totalLimit: { enabled: false },
      afterActions: [],
    },
  }
}

function reminderStepsOf(reminder) {
  const count = Number(reminder.stepCount ?? 0)
  return Array.from({ length: count }, (_, i) => ({
    id: `${reminder.id}-step-${i + 1}`,
    reminderId: reminder.id,
    offsetMinutes: Number(reminder.triggerOffsetMinutes ?? 0) + i * 60,
    offsetDays: null,
    sendAtTime: reminder.sendAtTime,
    templateId: null,
    messageType: 'text',
    messageContent: i === 0 ? 'ご予約日時が近づいています。' : 'あわせてご確認ください。',
    createdAt: '2026-06-02T00:00:00.000Z',
  }))
}

function bodyFor(pathname, query = new URLSearchParams()) {
  if (pathname === '/api/auth/session') {
    return { success: true, data: STAFF, csrfToken: 'visual-qa-csrf' }
  }
  if (pathname === '/api/operations/control/preview') {
    /* **「すべて」と1アカウントで数が変わる**ことを見るため、口の側でも分ける。 */
    return { success: true, data: query.get('account_id') ? OPERATION_CONTROL_PREVIEW_ONE : OPERATION_CONTROL_PREVIEW }
  }
  if (pathname === '/api/line-accounts') {
    /*
      `webhook` を付ける。無いと接続状態カードが「確認中」のままで、
      設計の「正常」と並べたときに実装の差に見えてしまう。
    */
    return { success: true, data: [{ ...ACCOUNT, webhook: { status: 'matched', checkedAt: `${FIXED_TO}T00:00:00.000Z` } }] }
  }
  if (pathname === '/api/identity-candidates') {
    if (query.get('visualState') === 'error') return IDENTITY_CANDIDATE_ERROR
    if (query.get('visualState') === 'empty') {
      return { success: true, data: IDENTITY_CANDIDATE_LISTS.empty }
    }
    const kind = query.get('kind') === 'ec_member' ? 'ec_member' : 'friend_duplicate'
    return { success: true, data: IDENTITY_CANDIDATE_LISTS[kind] }
  }
  const identityCandidate = /^\/api\/identity-candidates\/([^/]+)$/.exec(pathname)
  if (identityCandidate) {
    if (query.get('visualState') === 'error') return IDENTITY_CANDIDATE_ERROR
    const candidate = identityCandidate[1] === IDENTITY_CANDIDATE_EC.id
      ? IDENTITY_CANDIDATE_EC
      : IDENTITY_CANDIDATE_FRIEND
    return { success: true, data: candidate }
  }
  const mergedPerson = /^\/api\/friends\/people\/([^/]+)$/.exec(pathname)
  if (mergedPerson) {
    if (query.get('visualState') === 'error') return MERGED_PERSON_ERROR
    if (query.get('visualState') === 'empty') {
      return { success: true, data: MERGED_PERSON_EMPTY }
    }
    return { success: true, data: MERGED_PERSON_DETAIL }
  }
  if (pathname === '/api/dashboard/preferences') {
    /*
      設計 `vUXKb` の並び。**「友だちの状態」は既定では出ない**カードだが、
      設計の絵では出ている（運用者が出す設定にした状態）。ここでその設定を
      返して、設計と同じ並びで撮れるようにする。
      `null` を返すと組み込みの既定になり、絵が変わる。
    */
    return { success: true, data: DASHBOARD_PREFERENCES }
  }
  // 設計と画像で比べるための中身。空の表しか描けないと、
  // 「空の状態」だけを見て一致したと言えてしまう。
  // 受信箱（設計 `xGLVe`）。空で返すと一覧も吹き出しも出ない。
  const chat = pathname.match(/^\/api\/chats\/([^/]+)$/)
  if (chat) {
    // 一覧と同じ行を返す。`{items,total}` のままだと、開いた会話の名前が
    // `undefined` になり `friendName.charAt(0)` で落ちる。
    const row = CHATS.find((c) => c.id === chat[1])
    if (row) return { success: true, data: { ...row, messages: FRIEND_MESSAGES[row.friendId] ?? [] } }
  }
  const detail = pathname.match(/^\/api\/friends\/([^/]+)$/)
  if (detail && FRIEND_DETAILS[detail[1]]) return { success: true, data: FRIEND_DETAILS[detail[1]] }
  if (/^\/api\/friends\/[^/]+\/mileage$/.test(pathname)) return { success: true, data: FRIEND_MILEAGE }
  const messages = pathname.match(/^\/api\/friends\/([^/]+)\/messages$/)
  if (messages) {
    // 設計 `xGLVe` のトーク欄。載っていない友だちは空で返す（実際に空の人もいる）。
    return { success: true, data: FRIEND_MESSAGES[messages[1]] ?? [] }
  }
  // テンプレート選択（設計 `NfgOs` / `NWbuF`）。空だと選ぶものが1つも出ない。
  if (pathname === '/api/templates') {
    /* **質問のひな形も一覧に混ぜる。** 下書きが選択肢に出ないことを見るため。 */
    return { success: true, data: [...TEMPLATES, QUESTION_TEMPLATE_PUBLISHED, QUESTION_TEMPLATE_DRAFT] }
  }
  const tplUsages = /^\/api\/templates\/([^/]+)\/usages$/.exec(pathname)
  if (tplUsages) {
    /* 使用先。**公開済みの質問は2つのシナリオで使われている**ことにする。 */
    if (tplUsages[1] === 'template-q-pub') {
      return { success: true, data: { autoReplies: [], scenarioSteps: [
        { scenarioId: 'scenario-1', scenarioName: '新規登録7日間フォロー', stepId: 'ss-2', stepOrder: 2 },
        { scenarioId: 'scenario-2', scenarioName: '休眠ユーザー復帰', stepId: 'ss-9', stepOrder: 1 },
      ] } }
    }
    return { success: true, data: { autoReplies: [], scenarioSteps: [] } }
  }
  const oneTemplate = /^\/api\/templates\/([^/]+)$/.exec(pathname)
  if (oneTemplate) {
    /*
      1件取得。**保存したものをそのまま返す**（`SAVED_TEMPLATES`）。
      作り直した値を返すと、回答先が保たれたのか、こちらが作り直した
      のかが区別できなくなる。
    */
    const saved = SAVED_TEMPLATES.get(oneTemplate[1])
    if (saved) return { success: true, data: saved }
    const found = [...TEMPLATES, QUESTION_TEMPLATE_PUBLISHED, QUESTION_TEMPLATE_DRAFT]
      .find((t) => t.id === oneTemplate[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'broadcast') {
    return { success: true, data: BROADCAST_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'template') {
    return { success: true, data: TEMPLATE_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'reminder') {
    return { success: true, data: REMINDER_FOLDERS }
  }
  if (pathname === '/api/friend-fields') {
    /*
      `usageCount` は型のとおり **`?withUsage=1` のときだけ付ける**
      （`FriendField` の覚え書き）。いつも付けると、付かない側の道
      （実装は `usageCount ?? '—'`）を一度も撮らないまま合格にしてしまう。
    */
    const withUsage = query.get('withUsage')
    const data = withUsage && withUsage !== '0' && withUsage !== 'false'
      ? FRIEND_FIELDS
      : FRIEND_FIELDS.map(({ usageCount, ...rest }) => rest)
    return { success: true, data }
  }
  /* 帯は一覧とは別の口。`/api/friend-fields-stats`（枝ではなくハイフン）。 */
  if (pathname === '/api/friend-fields-stats') return { success: true, data: FRIEND_FIELD_SUMMARY }
  if (pathname === '/api/folders' && query.get('kind') === 'common_var') {
    return { success: true, data: COMMON_VAR_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'media') {
    return { success: true, data: MEDIA_FOLDERS }
  }
  /*
    予約の口は **`{success, data}` ではない**。`{requests}` `{menus}` のように
    それぞれ別の名前で包んで返す（`apps/web/src/lib/api.ts` の `bookingAdminApi`）。
  */
  /* 健全性は `{status:'ok'}` の通。一覧の既定を返すと状態が読めない。 */
  if (pathname === '/api/health') return { success: true, data: { status: 'ok' } }
  if (pathname === '/api/ad-platforms') return { success: true, data: AD_PLATFORMS }
  const adLogs = /^\/api\/ad-platforms\/([^/]+)\/logs$/.exec(pathname)
  if (adLogs) {
    return { success: true, data: AD_CONVERSION_LOGS.filter((l) => l.adPlatformId === adLogs[1]) }
  }
  if (pathname === '/api/saved-searches') {
    /*
      **同じ道で2つの型が返る。** `format=segment_v1` は配信の対象条件、
      無印は受信箱の絞り込み。返す型を取り違えると、受信箱の条件で
      配信を送る絵になる。
    */
    if (query.get('format') === 'segment_v1') return { success: true, data: SEGMENT_PRESETS }
    return { success: true, data: SAVED_SEARCHES }
  }
  if (pathname === '/api/support-marks') return { success: true, data: SUPPORT_MARKS }
  if (pathname === '/api/staff') return { success: true, data: STAFF_MEMBERS }
  if (pathname === '/api/staff/me') return { success: true, data: STAFF_MEMBERS[0] }
  if (pathname === '/api/events/admin/events') return { items: EVENTS }
  /* 申込者の一覧（`i5SN2j`）。`?status=` で絞る形にも合わせる。 */
  {
    const eb = /^\/api\/events\/admin\/events\/([^/]+)\/bookings$/.exec(pathname)
    if (eb) {
      const want = query.get('status')
      const rows = EVENT_BOOKINGS.filter((r) => r.event_id === eb[1])
      return { items: want ? rows.filter((r) => r.status === want) : rows }
    }
  }
  const eventOne = /^\/api\/events\/admin\/events\/([^/]+)$/.exec(pathname)
  if (eventOne) {
    const found = EVENTS.find((item) => item.id === eventOne[1])
    return found
      ? { ...found, confirmation_message_extra: null, reminder_message_extra: null, og_title: null, og_description: null, slots: [] }
      : { success: false, error: 'Not found' }
  }
  const eventBookings = /^\/api\/events\/admin\/events\/([^/]+)\/bookings$/.exec(pathname)
  if (eventBookings) return { items: [] }
  /*
    キャンセル待ち。**包まずに `waitlist` で返す**
    （`api.ts:4140` が `{ waitlist: EventWaitlistItem[] }` を読む）。
    無いと `waitlist.length` で画面ごと落ちる。

    **並んでいる人と、声をかけた人の2つを入れる。** `status` は
    `waiting`（並んでいる）と `invited`（声をかけた）で、
    声をかけた人だけ `notified_at` を持つ。0件にすると、
    「あと少しで満席」の見え方を確かめられない。
  */
  const eventWaitlist = /^\/api\/events\/admin\/events\/([^/]+)\/waitlist$/.exec(pathname)
  if (eventWaitlist) {
    return { waitlist: [
      {
        id: 'ew-1', slot_id: 'es-1', friend_id: 'friend-2', status: 'waiting',
        notified_at: null, created_at: '2026-08-27T02:10:00.000Z',
        slot_starts_at: '2026-09-05T01:00:00.000Z', friend_name: '佐藤 花子',
      },
      {
        id: 'ew-2', slot_id: 'es-1', friend_id: 'friend-3', status: 'invited',
        notified_at: '2026-08-28T05:00:00.000Z', created_at: '2026-08-27T06:40:00.000Z',
        slot_starts_at: '2026-09-05T01:00:00.000Z', friend_name: null,
      },
    ] }
  }
  if (pathname === '/api/booking/admin/requests') return { requests: BOOKING_REQUESTS }
  if (pathname === '/api/booking/admin/menus') return { menus: BOOKING_MENUS }
  if (pathname === '/api/booking/admin/staff') return { staff: BOOKING_STAFF }
  /*
    代理予約の担当者と空き時間。**メニュー側から引く担当者は値段を持つ。**
    空きは問い合わせた日をそのまま返す（撮影日に左右されないため）。
  */
  const menuStaff = /^\/api\/booking\/admin\/menus\/([^/]+)\/staff$/.exec(pathname)
  if (menuStaff) return { staff: BOOKING_MENU_STAFF }
  if (pathname === '/api/booking/admin/availability') {
    /* `?empty=1` で枠が消えた状態を返す（`Lg8ff` の競合回復を撮るため）。 */
    return bookingAvailability(query.get('from') ?? '', query.get('staff_id') ?? '', {
      empty: query.get('empty') === '1',
    })
  }
  if (pathname === '/api/booking/admin/pending-count') {
    return { count: BOOKING_REQUESTS.filter((b) => b.status === 'requested').length }
  }
  if (pathname === '/api/webhooks/outgoing') return { success: true, data: OUTGOING_WEBHOOKS }
  if (pathname === '/api/webhooks/incoming') return { success: true, data: INCOMING_WEBHOOKS }
  if (pathname === '/api/webhooks/interactions') return { success: true, data: INTEGRATION_RECORDS }
  if (pathname === '/api/automations') return { success: true, data: AUTOMATIONS }
  if (pathname === '/api/automation-templates') return { success: true, data: AUTOMATION_TEMPLATES }
  const automationOne = /^\/api\/automations\/([^/]+)$/.exec(pathname)
  if (automationOne) {
    const found = AUTOMATIONS.find((item) => item.id === automationOne[1])
    return found
      ? { success: true, data: { ...found, logs: AUTOMATION_LOGS.filter((log) => log.automationId === found.id) } }
      : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/automation-logs') return { success: true, data: AUTOMATION_LOGS }
  if (pathname === '/api/common-actions') return { success: true, data: COMMON_ACTIONS }
  if (pathname === '/api/common-actions/resources') {
    /* **`{tags, scenarios, templates, webhooks, richMenus, commonActions}` の通。**
       一覧の既定を返すと、作る画面が `tags.map` で落ちる。 */
    return {
      success: true,
      data: {
        tags: TAGS.slice(0, 8).map((t) => ({ id: t.id, name: t.name })),
        scenarios: FRIEND_SCENARIOS.map((sc) => ({ id: sc.id, name: sc.name })),
        templates: TEMPLATES.slice(0, 8).map((t) => ({ id: t.id, name: t.name })),
        webhooks: [{ id: 'wh-1', name: 'Slack（対応チーム）' }],
        richMenus: RICH_MENU_GROUPS.map((g) => ({ id: g.id, name: g.name })),
        commonActions: COMMON_ACTIONS.filter((c) => c.publishedVersion)
          .map((c) => ({ id: c.id, name: c.name, version: c.publishedVersion })),
      },
    }
  }
  const commonActionOne = /^\/api\/common-actions\/([^/]+)$/.exec(pathname)
  if (commonActionOne) {
    const found = COMMON_ACTIONS.find((item) => item.id === commonActionOne[1])
    if (!found) return { success: false, error: 'Not found' }
    /* **`versions` と `bindings` を通で付ける。** 版の画面が `versions.find` で落ちる。 */
    const steps = [
      { id: 's1', type: 'add_tag', params: { tagId: 'tag-0' }, onFailure: 'stop' },
      { id: 's2', type: 'wait', params: { minutes: 30 }, onFailure: 'continue' },
      { id: 's3', type: 'send_message', params: { templateId: 'template-1' }, onFailure: 'continue' },
      { id: 's4', type: 'start_scenario', params: { scenarioId: 'scenario-0' }, onFailure: 'stop' },
      { id: 's5', type: 'send_webhook', params: { webhookId: 'wh-1' }, onFailure: 'continue' },
    ]
    const published = found.publishedVersion ?? 1
    return {
      success: true,
      data: {
        id: found.id, name: found.name, description: found.description, status: found.status,
        currentDraftVersionId: found.draftVersion ? `${found.id}-v${found.draftVersion}` : null,
        currentPublishedVersionId: `${found.id}-v${published}`,
        versions: Array.from({ length: published }, (_, i) => ({
          id: `${found.id}-v${i + 1}`, versionNumber: i + 1,
          status: i + 1 === published ? 'published' : 'published',
          actions: steps.slice(0, found.actionCount),
          createdBy: '川野 健太',
          createdAt: '2026-06-01T00:00:00.000Z',
          publishedAt: '2026-08-20T00:00:00.000Z',
        })),
        bindings: [
          {
            id: 'cb-1', consumerType: 'scenario', consumerId: 'scenario-0',
            consumerPath: '体験前フォロー・1通目のあと',
            versionId: `${found.id}-v${published}`, versionNumber: published,
            latestVersionNumber: published, hasNewerVersion: false,
            runningCount: 12, waitingCount: 0,
          },
          {
            /* **古い版のまま呼んでいる先。** 設計の「要確認 1」に対応。 */
            id: 'cb-2', consumerType: 'form', consumerId: 'form-1',
            consumerPath: '体験のお申し込み・送信後',
            versionId: `${found.id}-v${Math.max(1, published - 1)}`,
            versionNumber: Math.max(1, published - 1),
            latestVersionNumber: published, hasNewerVersion: true,
            runningCount: 0, waitingCount: 3,
          },
        ],
      },
    }
  }
  if (pathname === '/api/ec-commerce/overview') return { success: true, data: EC_OVERVIEW }
  if (pathname === '/api/ec-commerce/events') {
    /* **`pagination` を添える。** 返事の形に入っている。 */
    return {
      success: true,
      data: EC_EVENTS,
      pagination: { total: EC_OVERVIEW.total, limit: 20, offset: 0 },
    }
  }
  if (pathname === '/api/ec-commerce/settings') return { success: true, data: EC_SETTINGS }
  if (pathname === '/api/nen-members/photos') return { success: true, data: NEN_PHOTOS }
  if (pathname === '/api/nen-campaigns/overview') return { success: true, data: NEN_OVERVIEW }
  if (pathname === '/api/nen-campaigns/settings') return { success: true, data: NEN_CAMPAIGN_SETTINGS }
  if (pathname === '/api/nen-campaigns/columns') return { success: true, data: NEN_COLUMNS }
  if (pathname === '/api/nen-campaigns/pets') return { success: true, data: NEN_PETS }
  if (pathname === '/api/nen-campaigns/jobs') return { success: true, data: NEN_JOBS }
  /* 機能20の4タブ（PR #445）。**どれも封筒つき**（`AnalyticsEnvelope`）。 */
  /*
    支払い（`njLGA`・#585 `75d6eb9a`）。**実装のコードで確かめた口。**
    返事は `{ success, data, limitations }` で、`ApiResponse` の入れ子ではない
    （`api.ts:2391`）。**そのまま返す。**
  */
  if (pathname === '/api/affiliate-payments') return AFFILIATE_PAYMENTS
  /*
    支払いを確定する（`GqFTV`）。**Codexが実装する前の下ごしらえ。口もルートも
    「想定」で正本ではない。**PRのheadが届いたら実装で確かめる。
  */
  if (pathname === '/api/affiliate-payment-periods') return AFFILIATE_PAYMENT_PERIODS
  if (pathname === '/api/analytics/friends') return { success: true, data: ANALYTICS_FRIENDS }
  if (pathname === '/api/analytics/reactions') return { success: true, data: ANALYTICS_REACTIONS }
  if (pathname === '/api/analytics/routes') return { success: true, data: ANALYTICS_ROUTES }
  if (pathname === '/api/analytics/usage') return { success: true, data: ANALYTICS_USAGE }
  if (pathname === '/api/analytics/url-clicks') return { success: true, data: ANALYTICS_URL_CLICKS }
  if (pathname === '/api/analytics/messages') return { success: true, data: ANALYTICS_MESSAGES }
  if (pathname === '/api/analytics/broadcasts') return { success: true, data: ANALYTICS_BROADCASTS }
  if (pathname === '/api/analytics/tracked-links') return { success: true, data: ANALYTICS_TRACKED_LINKS }
  if (pathname === '/api/analytics/link-clicks') {
    return {
      success: true,
      data: ANALYTICS_TRACKED_LINKS.map((item) => ({
        trackedLinkId: item.trackedLinkId, name: item.name,
        clicks: item.clicks, uniqueFriends: item.uniqueFriends,
      })),
    }
  }
  if (pathname === '/api/analytics/cross') return { success: true, data: ANALYTICS_CROSS }
  /*
    配信前チェック。**数えるだけで、何も保存しない。**
    `audienceCount` は20以上にしてある。20未満だと LINE 側の決まりで
    開封が数えられず、**「開封は集計されません」側しか撮れない。**
  */
  if (pathname === '/api/broadcasts/preflight') {
    return {
      success: true,
      data: {
        audienceCount: 1284,
        warnings: [
          { level: 'info', message: 'ブロック中の友だち 42人を除いています' },
          { level: 'warning', message: '同じ本文の配信を、この7日で1回送っています' },
        ],
      },
    }
  }
  /* PR #445 で増えた口。**当てはめが無いと一覧の既定が返り、画面が落ちる。** */
  if (pathname === '/api/analytics/funnels') return { success: true, data: ANALYTICS_FUNNEL_DEFS }
  if (/^\/api\/analytics\/funnels\/[^/]+\/runs\/latest$/.test(pathname)) {
    return { success: true, data: { ...ANALYTICS_FUNNEL_RUN, funnelId: pathname.split('/')[4] } }
  }
  if (/^\/api\/analytics\/funnels\/[^/]+\/run$/.test(pathname)) {
    return { success: true, data: { ...ANALYTICS_FUNNEL_RUN, funnelId: pathname.split('/')[4] } }
  }
  if (pathname === '/api/analytics/saved') return { success: true, data: SAVED_ANALYTICS }
  if (/^\/api\/analytics\/saved\/[^/]+\/snapshots$/.test(pathname)) {
    return { success: true, data: SAVED_ANALYTICS_SNAPSHOTS }
  }
  if (/^\/api\/analytics\/results\/[^/]+\/audiences$/.test(pathname)) {
    return { success: true, data: { audienceId: 'aud-1', friendCount: 42, state: 'available', stateReason: null } }
  }
  if (pathname === '/api/entry-routes') return { success: true, data: ENTRY_ROUTES }
  /*
    流入リンクの詳細（`JupxW` `UIaM7`・#574）。**1件・ファネル・流入元の3つ。**
    無いと一覧の既定（配列）が返り、画面が `route.refCode` で落ちる。

    型は実装に合わせた——1件は `EntryRoute`、ファネルは `EntryRouteFunnel`
    （`packages/shared/src/types.ts:838` の**スネークケース4つ**）、流入元は
    `{ label, count }` の並び（`api.ts:4201`）。
  */
  {
    const one = pathname.match(/^\/api\/entry-routes\/([^/]+)$/)
    if (one) {
      const row = ENTRY_ROUTES.find((r) => r.id === one[1])
      return row ? { success: true, data: row } : { status: 404, body: { success: false, error: 'not found' } }
    }
    const funnel = pathname.match(/^\/api\/entry-routes\/([^/]+)\/funnel$/)
    if (funnel) {
      return { success: true, data: { click_count: 486, friend_add_count: 86, form_submission_count: 24, cv_count: 11 } }
    }
    const sources = pathname.match(/^\/api\/entry-routes\/([^/]+)\/sources$/)
    if (sources) {
      return { success: true, data: [
        { label: 'instagram', count: 312 },
        { label: 'lin.ee', count: 96 },
        { label: '直接アクセス', count: 78 },
      ] }
    }
  }
  if (pathname === '/api/entry-route-genres') return { success: true, data: ENTRY_ROUTE_GENRES }
  if (pathname === '/api/analytics/ref-summary') return { success: true, data: REF_SUMMARY }
  if (pathname === '/api/mileage/overview') return { success: true, data: MILEAGE_OVERVIEW }
  if (pathname === '/api/mileage/rules') return { success: true, data: MILEAGE_RULES }
  /* PR #441 で増えた口。無いと一覧の既定が返り、履歴タブが落ちる。 */
  if (pathname === '/api/mileage/history') return { success: true, data: MILEAGE_HISTORY }
  /*
    #494 で増えた口。**`configured: true` と `approvalThreshold` を入れる。**
    未設定だと「別のオーナー承認が必要になるマイル数」の欄しか撮れず、
    決まっているときの絵が撮れない。
  */
  /*
    行動スコア（PR #495）。**絞り込み・検索・並び順・ページ送りを
    ここで効かせる。** 効かせないと、押しても数が変わらず
    「効いていない」ように見える。
  */
  if (pathname === '/api/action-scores/friends') {
    const filter = query.get('filter') ?? 'all'
    const search = (query.get('search') ?? '').trim()
    const sort = query.get('sort') ?? 'score_desc'
    const limit = Number(query.get('limit') ?? 20)
    const offset = Number(query.get('offset') ?? 0)
    let items = ACTION_SCORES.items
    if (filter === 'decreased') items = items.filter((x) => x.change30d < 0)
    else if (filter !== 'all') items = items.filter((x) => x.band === filter)
    if (search) items = items.filter((x) => x.displayName.includes(search))
    const by = {
      score_desc: (a, b) => b.currentScore - a.currentScore,
      score_asc: (a, b) => a.currentScore - b.currentScore,
      change_desc: (a, b) => b.change30d - a.change30d,
      change_asc: (a, b) => a.change30d - b.change30d,
      recent_desc: (a, b) => String(b.lastChangedAt ?? '').localeCompare(String(a.lastChangedAt ?? '')),
    }
    items = [...items].sort(by[sort] ?? by.score_desc)
    return {
      success: true,
      data: {
        summary: ACTION_SCORES.summary,
        items: items.slice(offset, offset + limit),
        pagination: { total: items.length, limit, offset },
      },
    }
  }
  /*
    行動スコアのルール（PR #496）。**版のかたちをそのまま返す。**
    `editableVersion` が無いと画面が何も描かず、実装が落ちたように見える。
  */
  if (pathname === '/api/action-scores/rules') {
    return { success: true, data: ACTION_SCORE_RULE_CONFIG }
  }
  if (pathname === '/api/action-scores/bands') {
    return { success: true, data: ACTION_SCORE_BANDS }
  }
  if (pathname === '/api/mileage/adjustment-policy') {
    return { success: true, data: { configured: true, approvalThreshold: 5000 } }
  }
  if (pathname === '/api/affiliates') return { success: true, data: AFFILIATES }
  if (pathname === '/api/affiliates-report') return { success: true, data: AFFILIATES_REPORT }
  if (pathname === '/api/affiliate-offers') return { success: true, data: AFFILIATE_OFFERS }
  if (pathname === '/api/conversions/approvals') return { success: true, data: CONVERSION_APPROVALS }
  if (pathname === '/api/conversion-points') return { success: true, data: CONVERSION_POINTS }
  if (pathname === '/api/conversions/points') return { success: true, data: CONVERSION_POINTS }
  /* 計測をやめる前に出す影響。窓（`d8d3Mz`）がこれを待つ。 */
  if (/^\/api\/conversions\/points\/[^/]+\/impact$/.test(pathname)) {
    const id = pathname.split('/')[4]
    const point = CONVERSION_POINTS.find((p) => p.id === id) ?? CONVERSION_POINTS[0]
    const impact = CONVERSION_POINT_IMPACTS[point.id] ?? { eventCount: 0, totalValue: 0 }
    return { success: true, data: { point, ...impact, usedIn: point.usedIn } }
  }
  if (pathname === '/api/conversions/report') {
    return {
      success: true,
      data: CONVERSION_POINTS.map((point, i) => ({
        conversionPointId: point.id,
        conversionPointName: point.name,
        eventType: point.eventType,
        totalCount: [386, 42, 58][i] ?? 0,
        totalValue: [1158000, 126000, 0][i] ?? 0,
      })),
    }
  }
  const affLinks = /^\/api\/affiliates\/([^/]+)\/links$/.exec(pathname)
  if (affLinks) return { success: true, data: AFFILIATE_LINKS }
  /*
    **返事は配列。** ここは `{ items, total }` を返していて、画面の
    `journeys.map(...)` で内訳の面ごと落ちていた。型
    （`api.ts` の `affiliates.journeys`）は `data: Array<...>` と
    `nextCursor`。**当てずっぽうの形を置くと、画面の不具合に見える。**
  */
  const affJourneys = /^\/api\/affiliates\/([^/]+)\/journeys$/.exec(pathname)
  if (affJourneys) return { success: true, data: AFFILIATE_JOURNEYS, nextCursor: null }
  const affReport = /^\/api\/affiliates\/([^/]+)\/report$/.exec(pathname)
  if (affReport) {
    const row = AFFILIATES_REPORT.find((item) => item.affiliateId === affReport[1]) ?? AFFILIATES_REPORT[0]
    return {
      success: true,
      data: {
        affiliateId: row.affiliateId, affiliateName: row.affiliateName, code: row.code,
        commissionRate: row.commissionRate,
        clicks: row.totalClicks, linkClicks: row.totalClicks, friendAdds: row.friendAdds,
        conversions: row.totalConversions,
        conversionsPending: 2, conversionsApproved: row.totalConversions - 2, conversionsRejected: 0,
        conversionsByPoint: CONVERSION_POINTS.map((point, i) => ({
          conversionPointId: point.id, name: point.name, count: [7, 3, 2][i] ?? 0, value: point.value ?? 0,
        })),
        revenue: row.totalRevenue, estimatedCommission: 86000, confirmedReward: 86000,
        byOffer: AFFILIATE_OFFERS.slice(0, 3).map((offer, i) => ({
          offerId: offer.id, offerName: offer.name, rewardAmount: offer.rewardAmount ?? 0,
          conversionsApproved: [7, 2, 1][i], conversionsPending: [2, 0, 0][i],
          confirmedReward: [21000, 16000, 300][i],
        })),
        duplicateFlags: [{ friendId: 'friend-4', identityKey: 'friend-4:offer-1' }],
      },
    }
  }
  const affOne = /^\/api\/affiliates\/([^/]+)$/.exec(pathname)
  if (affOne) {
    const found = AFFILIATES.find((item) => item.id === affOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/media') return { success: true, data: MEDIA_ITEMS }
  const mediaUsage = /^\/api\/media\/([^/]+)\/usages?$/.exec(pathname)
  if (mediaUsage) return { success: true, data: MEDIA_USAGE[mediaUsage[1]] ?? [] }
  const mediaOne = /^\/api\/media\/([^/]+)$/.exec(pathname)
  if (mediaOne) {
    const found = MEDIA_ITEMS.find((item) => item.id === mediaOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/common-vars') return { success: true, data: COMMON_VARS }
  const cvSchedules = /^\/api\/common-vars\/([^/]+)\/schedules$/.exec(pathname)
  if (cvSchedules) return { success: true, data: COMMON_VAR_SCHEDULES[cvSchedules[1]] ?? [] }
  const cvOne = /^\/api\/common-vars\/([^/]+)$/.exec(pathname)
  if (cvOne) {
    const found = COMMON_VARS.find((item) => item.id === cvOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/forms') return { success: true, data: FORMS }
  const formSubs = /^\/api\/forms\/([^/]+)\/submissions$/.exec(pathname)
  if (formSubs) {
    /*
      **返す形が2つある。** ページを指定しなければ**配列のまま**返す
      （既存SDKとの互換。`apps/worker/src/routes/forms.ts:452`）。
      `page` か `limit` が付いたときだけ `{items,total,page,limit}`（`:457`）。
      片方だけ真似ると、SDKを壊していないことを確かめられない。

      **数の丸めもDBと同じにする**（`packages/db/src/forms.ts:395`）。
      `page` は1以上、`limit` は1〜50。**丸めた後の値を返す**ので、
      画面に出る番号はDBが実際に使った値になる。
    */
    const rows = FORM_SUBMISSIONS.filter((item) => item.formId === formSubs[1])
    if (!query.has('page') && !query.has('limit')) return { success: true, data: rows }
    const page = Math.max(1, Math.floor(Number(query.get('page') ?? '1')))
    const limit = Math.max(1, Math.min(Math.floor(Number(query.get('limit') ?? '20')), 50))
    const offset = (page - 1) * limit
    return { success: true, data: { items: rows.slice(offset, offset + limit), total: rows.length, page, limit } }
  }
  const formOne = /^\/api\/forms\/([^/]+)$/.exec(pathname)
  if (formOne) {
    const found = FORMS.find((item) => item.id === formOne[1])
    return found
      ? {
          success: true,
          data: {
            ...found,
            /* **`FormLayout` の形で返す。** `{sections:[]}` だけでは
               `version` も `header` も `options` も無く、編集画面が落ちる。 */
            layout: found.id === 'form-1' ? FORM_LAYOUT_VISIT : emptyFormLayout(found),
            onSubmitTagId: null, onSubmitMessageType: null, onSubmitMessageContent: null,
          },
        }
      : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'rich_menu') {
    return { success: true, data: RICH_MENU_FOLDERS }
  }
  if (pathname === '/api/rich-menu-groups/external') return { success: true, data: RICH_MENU_EXTERNAL }
  if (pathname === '/api/rich-menu-groups/tap-stats') return { success: true, data: RICH_MENU_TAP_STATS }
  if (pathname === '/api/rich-menu-groups') return { success: true, data: RICH_MENU_GROUPS }
  const richMenuOne = /^\/api\/rich-menu-groups\/([^/]+)$/.exec(pathname)
  if (richMenuOne) {
    const detail = RICH_MENU_GROUP_DETAILS[richMenuOne[1]]
    if (detail) return { success: true, data: detail }
    const group = RICH_MENU_GROUPS.find((item) => item.id === richMenuOne[1])
    /* **`pages` は必ず付ける。** 無いと編集画面が `pages[0]` で落ちる。 */
    return group
      ? { success: true, data: { ...group, createdAt: group.updatedAt, pages: [] } }
      : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/broadcast-message-assets') {
    const kind = query.get('kind')
    return {
      success: true,
      data: kind ? BROADCAST_MESSAGE_ASSETS.filter((item) => item.kind === kind) : BROADCAST_MESSAGE_ASSETS,
    }
  }
  if (pathname === '/api/webinars') return { success: true, data: WEBINARS }
  const webinarAnalytics = /^\/api\/webinars\/([^/]+)\/analytics$/.exec(pathname)
  if (webinarAnalytics) return { success: true, data: WEBINAR_ANALYTICS }
  const webinarSub = /^\/api\/webinars\/([^/]+)\/(comments|ctas|participants|user-comments|reservations)$/.exec(pathname)
  if (webinarSub) return { success: true, data: [] }
  const webinarOne = /^\/api\/webinars\/([^/]+)$/.exec(pathname)
  if (webinarOne) {
    const found = WEBINARS.find((item) => item.id === webinarOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/friends/add-breakdown') return { success: true, data: FRIEND_ADD_BREAKDOWN }
  if (pathname === '/api/friend-add-routing/events') return { success: true, data: FRIEND_ADD_EVENTS }
  /* 友だち追加時配信の公開前確認（PR #597）。契約と同じ形を返す。 */
  if (pathname === '/api/friend-add-routing/draft') {
    if (query.get('visualState') === 'empty') return { status: 404, body: FRIEND_ADD_LIFECYCLE_EMPTY }
    if (query.get('visualState') === 'error') return { status: 500, body: FRIEND_ADD_LIFECYCLE_ERROR }
    return { success: true, data: FRIEND_ADD_LIFECYCLE_DRAFT }
  }
  if (pathname === '/api/friend-add-routing/validate') {
    return { success: true, data: FRIEND_ADD_LIFECYCLE_VALIDATION }
  }
  if (pathname === '/api/friend-add-routing/draft/test') {
    return { success: true, data: FRIEND_ADD_LIFECYCLE_TEST_RESULT }
  }
  if (pathname === '/api/friend-add-routing/publish') {
    return { success: true, data: FRIEND_ADD_LIFECYCLE_PUBLISHED }
  }
  if (pathname === '/api/friend-add-routing/conflicts') {
    return { success: true, data: { conflicts: [] } }
  }
  if (pathname === '/api/friend-add-routing') {
    /* **`{routing, scenarios, tags}` の通。** 一覧の既定を返すと画面が読めない。 */
    return {
      success: true,
      data: {
        /* **`configured` を返す。** 無いと画面は「まだ決めていない」の
           注意帯を出し続け、設定してあるのに未設定の絵で撮れる。 */
        configured: true,
        routing: FRIEND_ADD_ROUTING,
        scenarios: FRIEND_SCENARIOS.map((item) => ({ id: item.id, name: item.name })),
        tags: TAGS.slice(0, 8).map((item) => ({ id: item.id, name: item.name })),
      },
    }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'auto_reply') {
    return { success: true, data: AUTO_REPLY_FOLDERS }
  }
  if (pathname === '/api/auto-replies') return { success: true, data: AUTO_REPLIES }
  /*
    自動応答の下書き・確認・試験・公開（`U9hzqH` `g46ja` `Yj6CQ` `e6iJG`・#595）。

    **`?deny=1` で権限不足（403）を返せる。**この4画面は本番のルールを
    書き換える手前なので、**権限が無いときにどう見えるか**まで撮る。
    **`?untested=1` は試験がまだの下書き**、**`?lost=1` は下書きが負ける試験。**
  */
  {
    const draft = /^\/api\/auto-replies\/([^/]+)\/draft$/.exec(pathname)
    if (draft) {
      if (query.get('deny') === '1') return { status: 403, body: { success: false, error: 'forbidden' } }
      return { success: true, data: query.get('untested') === '1' ? AUTO_REPLY_DRAFT_UNTESTED : AUTO_REPLY_DRAFT }
    }
    const conflicts = /^\/api\/auto-replies\/([^/]+)\/conflicts$/.exec(pathname)
    if (conflicts) {
      if (query.get('deny') === '1') return { status: 403, body: { success: false, error: 'forbidden' } }
      return { success: true, data: { conflicts: query.get('empty') === '1' ? [] : AUTO_REPLY_CONFLICTS } }
    }
    const validate = /^\/api\/auto-replies\/([^/]+)\/validate$/.exec(pathname)
    if (validate) {
      return { success: true, data: query.get('ok') === '1' ? AUTO_REPLY_VALIDATION_OK : AUTO_REPLY_VALIDATION }
    }
    const test = /^\/api\/auto-replies\/([^/]+)\/test$/.exec(pathname)
    if (test) {
      return { success: true, data: query.get('lost') === '1' ? AUTO_REPLY_DRY_RUN_LOST : AUTO_REPLY_DRY_RUN }
    }
    const publish = /^\/api\/auto-replies\/([^/]+)\/publish$/.exec(pathname)
    if (publish) return { success: true, data: AUTO_REPLY_PUBLISHED }
  }
  const autoReplyOne = /^\/api\/auto-replies\/([^/]+)$/.exec(pathname)
  if (autoReplyOne) {
    const found = AUTO_REPLIES.find((item) => item.id === autoReplyOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  /*
    リマインダの実行結果（PR #500）。**絞り込み・検索・ページ送りを
    ここで効かせる。** 効かせないと、押しても数が変わらず
    「効いていない」ように見える。
  */
  if (/^\/api\/reminders\/[^/]+\/runs$/.test(pathname)) {
    const status = query.get('status') ?? ''
    const search = (query.get('search') ?? '').trim()
    const limit = Number(query.get('limit') ?? 20)
    const offset = Number(query.get('offset') ?? 0)
    let items = REMINDER_RUNS.items
    if (status) items = items.filter((x) => x.domainStatus === status)
    if (search) items = items.filter((x) => (x.friendName ?? '').includes(search))
    return {
      success: true,
      data: {
        ...REMINDER_RUNS,
        items: items.slice(offset, offset + limit),
        pagination: { total: items.length, limit, offset },
      },
    }
  }
  /*
    自動応答の実行結果（`t7UtYQ`）— PR #501。
    **口は1本。** `GET /api/auto-reply-runs?ruleId=rule-a`。
    仮に置いていた `/api/auto-replies/:id/runs` と
    `/api/execution-runs?ownerKind=auto_reply` は外した。

    絞り込み・検索・ページ送りをここで効かせる。効かせないと、
    押しても数が変わらず「効いていない」ように見える。
  */
  /*
    オートメーションの実行結果（`DkPY0`）— PR #502。
    口は `GET /api/automation-runs`。**新しい表は作っていない実装**で、
    既存の `automation_runs` を読むだけ。

    `status` は共通状態（6つ）のほか `executed`（動いたもの）と
    `problems`（一部だけ＋失敗）でも来る。実装の写像に合わせる。
  */
  if (pathname === '/api/automation-runs') {
    const status = query.get('status') ?? ''
    const search = (query.get('search') ?? '').trim()
    const limit = Number(query.get('limit') ?? 20)
    const offset = Number(query.get('offset') ?? 0)
    const DOMAIN = {
      executed: ['success', 'partial', 'failed'],
      problems: ['partial', 'failed'],
      succeeded: ['success'], partial: ['partial'], failed: ['failed'],
      skipped: ['skipped_condition'], cancelled: ['cancelled'],
      pending: ['queued', 'running', 'waiting'],
    }
    let items = AUTOMATION_RUNS.items
    if (status && DOMAIN[status]) items = items.filter((x) => DOMAIN[status].includes(x.domainStatus))
    if (search) {
      items = items.filter((x) =>
        (x.friendName ?? '').includes(search) || x.automationName.includes(search))
    }
    return {
      success: true,
      data: {
        ...AUTOMATION_RUNS,
        items: items.slice(offset, offset + limit),
        pagination: { total: items.length, limit, offset },
      },
    }
  }
  if (pathname === '/api/auto-reply-runs') {
    const status = query.get('status') ?? ''
    const search = (query.get('search') ?? '').trim()
    const limit = Number(query.get('limit') ?? 20)
    const offset = Number(query.get('offset') ?? 0)
    let items = AUTO_REPLY_RUNS.items
    /* `status` は台帳の状態（`AutoReplyEvaluationStatus`）で来る。 */
    if (status) items = items.filter((x) => x.domainStatus === status)
    if (search) {
      items = items.filter((x) =>
        (x.friendName ?? '').includes(search) || (x.inputPreview ?? '').includes(search))
    }
    return {
      success: true,
      data: {
        ...AUTO_REPLY_RUNS,
        items: items.slice(offset, offset + limit),
        pagination: { total: items.length, limit, offset },
      },
    }
  }
  if (pathname === '/api/reminders') return { success: true, data: REMINDERS }
  const remDraft = /^\/api\/reminders\/([^/]+)\/draft$/.exec(pathname)
  if (remDraft) return { success: true, data: REMINDER_DRAFT }
  const reminderOne = /^\/api\/reminders\/([^/]+)$/.exec(pathname)
  if (reminderOne) {
    const found = REMINDERS.find((item) => item.id === reminderOne[1])
    /*
      **`steps` を通で足す。** 編集画面は `api.reminders.get()` の返事を
      `Reminder & { steps: ReminderStep[] }` として読み、`steps.length` を
      すぐ見る。付けずに返すと画面ごと落ちる。
    */
    return found
      ? { success: true, data: { ...found, steps: reminderStepsOf(found) } }
      : { success: false, error: 'Not found' }
  }
  /*
    ステップは**通で返す**。一覧の既定（`{items,total,page,limit}`）を返すと
    編集画面が `steps` を回そうとして落ちる。機能5で2度やった。
  */
  const reminderSteps = /^\/api\/reminders\/([^/]+)\/steps$/.exec(pathname)
  if (reminderSteps) {
    const reminder = REMINDERS.find((item) => item.id === reminderSteps[1])
    return { success: true, data: reminder ? reminderStepsOf(reminder) : [] }
  }
  if (/^\/api\/scenarios\/[^/]+\/stats$/.test(pathname)) return { success: true, data: SCENARIO_STATS }
  const scenario = pathname.match(/^\/api\/scenarios\/([^/]+)$/)
  if (scenario) {
    // 通を配列で返す。`{items,total}` のままだと `scenario.steps` で落ちる。
    const row = FRIEND_SCENARIOS.find((r) => r.id === scenario[1]) ?? FRIEND_SCENARIOS[0]
    return { success: true, data: { ...row, steps: SCENARIO_STEPS.map((step) => ({ ...step, scenarioId: row.id })) } }
  }
  if (pathname === '/api/duplicates/stats') return { success: true, data: DUPLICATE_STATS }
  if (pathname === '/api/users-grouped') return { success: true, data: USERS_GROUPED }
  if (/^\/api\/webinars\/[^/]+\/notifications$/.test(pathname)) return { success: true, data: WEBINAR_NOTIFICATIONS }
  /* 使い道1件。編集画面が読む。無いと画面ごと落ちる。 */
  const reward = pathname.match(/^\/api\/mileage\/rewards\/([^/]+)$/)
  if (reward) {
    const row = MILEAGE_REWARDS.rewards.find((r) => r.id === reward[1]) ?? MILEAGE_REWARDS.rewards[0]
    return { success: true, data: row }
  }
  /* 紹介者1人ぶんの内訳と計測リンク。無いと内訳の面が落ちる。 */
  /* 顧客へのお知らせの記録。`view=failures` で送れなかったものだけ。 */
  if (pathname === '/api/ec-commerce/notification-runs') {
    const failuresOnly = query.get('view') === 'failures'
    const data = failuresOnly ? EC_NOTIFICATION_FAILURES : EC_NOTIFICATION_RUNS
    return { success: true, data, pagination: { total: data.items.length, limit: 20, offset: 0 } }
  }
  /* お知らせの一覧。**`counts` の4つが欠けると `undefined.all` で落ちる。** */
  if (pathname === '/api/notifications/center') return { success: true, data: NOTIFICATION_CENTER }
  if (pathname === '/api/notifications/rules') return { success: true, data: NOTIFICATION_RULES }
  if (pathname === '/api/broadcasts') return { success: true, data: BROADCASTS }
  /*
    **1件の配信。** 用意していなかったので一覧の既定が返り、詳細画面が
    「1通（undefined）」「Invalid Date 作成」と出していた。
    実装側に守りが無いのは残るが、**まず正しい形を返す。**
  */
  // `stats` を外す。外さないと `/api/broadcasts/stats` まで拾い、帯が1件の配信になる。実際にそうなった。
  const broadcast = pathname.match(/^\/api\/broadcasts\/(?!stats$)([^/]+)$/)
  if (broadcast) {
    const row = BROADCASTS.find((r) => r.id === broadcast[1]) ?? BROADCASTS[0]
    return { success: true, data: row }
  }
  if (pathname === '/api/inbox/saved-views') return { success: true, data: INBOX_SAVED_VIEWS }
  if (pathname === '/api/chats') return { success: true, data: CHATS }
  if (pathname === '/api/chats/stats') return { success: true, data: INBOX_STATS }
  /*
    受信箱の右にある顧客情報（`components/chats/friend-info-sidebar.tsx:6`）。
    **`tags` と `formSubmissions` を必ず配列で返す。** どちらかが
    無いと `.length` で**受信箱ごと落ちる**。
  */
  /* **`stats` を隠さない。** 足した道が、先にある道を覆うことがある（一斉配信で一度やった）。 */
  const friendDetail = /^\/api\/friends\/(?!stats$)([^/]+)$/.exec(pathname)
  if (friendDetail) {
    const f = FRIENDS.find((x) => x.id === friendDetail[1])
    return { success: true, data: {
      id: friendDetail[1],
      displayName: f?.displayName ?? null,
      pictureUrl: null, isFollowing: true, metadata: {},
      realName: null, systemDisplayName: null, refCode: null,
      createdAt: f?.createdAt ?? '2026-08-13T00:00:00.000Z',
      tags: (f?.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color ?? '#8B938D' })),
      formSubmissions: [],
    } }
  }
  /* 友だちにいま出ているリッチメニュー。**出していないときは `id: null`。** */
  const friendRichMenu = /^\/api\/friends\/([^/]+)\/rich-menu$/.exec(pathname)
  if (friendRichMenu) return { success: true, data: { id: null, name: null, isDefault: false } }
  /*
    やり取り1件。**`friendName` を必ず返す**（型は `ChatDetail`、
    `app/chats/page.tsx:54`。`Chat` を継ぎ、`friendName: string`）。

    `/chats?friend=<id>` は**友だちのid**をそのままこの道へ渡すので、
    やり取りの無い友だちでも引ける必要がある。返さないと、画面が
    作る行の `friendName` が `undefined` になり、`:1444` の
    `chat.friendName.charAt(0)` で受信箱ごと落ちる。
  */
  const oneChat = /^\/api\/chats\/([^/]+)$/.exec(pathname)
  if (oneChat) {
    const found = CHATS.find((c) => c.id === oneChat[1] || c.friendId === oneChat[1])
    const friend = FRIENDS.find((f) => f.id === oneChat[1])
    if (found) return { success: true, data: { ...found, messages: [] } }
    if (!friend) return { success: false, error: 'Not found' }
    /* やり取りがまだ無い友だち。**名前は友だちから採る。** */
    return { success: true, data: {
      id: friend.id, friendId: friend.id,
      friendName: friend.displayName || '名前の登録がありません',
      friendPictureUrl: null, operatorId: null, status: 'unread', notes: null,
      revision: 1, lastMessageAt: null, lastMessageContent: null,
      lastMessageDirection: null, lastMessageType: null, isUnread: false,
      createdAt: friend.createdAt ?? '2026-08-20T00:00:00.000Z', messages: [],
    } }
  }
  if (pathname === '/api/support/inbox') {
    /*
      **同じ口を2つの画面が読む。返す形が違う。**

      - ダッシュボード（`pending-inbox-card.tsx`）… `channel` を付けずに呼び、
        `{ items, summary }` を読む
      - 受信箱（`/chats`）… `channel=email` で呼び、`{ items }` の1件ずつに
        `status` `threadId` `subject` `revision` `isUnread` まで要る

      ダッシュボードの形だけで返していたとき、受信箱は
      `statusConfig[item.status].className` で落ちて**画面ごと真っ白**に
      なった。片方の画面のために形を変えると、もう片方が黙って壊れる。

      行は設計 `vUXKb` の表そのまま。**総数は5件**にしてページ送りを出す。
      1ページに収まる数で返すと、ページ送りが描かれず、そこを見張れない。
    */
    if (query.get('channel') === 'email') {
      return { success: true, data: { items: SUPPORT_EMAIL_ITEMS } }
    }
    return {
      success: true,
      data: {
        items: SUPPORT_INBOX_ITEMS,
        summary: { total: 5, line: 1, email: 4, emailUnread: 4, oldestWaitMinutes: 9110 },
      },
    }
  }
  if (pathname === '/api/tags') return { success: true, data: TAGS }
  /*
   * 削除する前の影響（PR #381）。**一覧の `usedIn` から組み立てる。**
   * 別々に持つと、一覧が「配信3」なのに削除画面は「なし」という
   * ありえない絵になり、どちらが本当か分からなくなる。
   */
  const deleteImpact = /^\/api\/tags\/([^/]+)\/delete-impact$/.exec(pathname)
  if (deleteImpact) {
    const tag = TAGS.find((item) => item.id === deleteImpact[1])
    if (!tag) return { success: false, error: 'Not found' }
    return { success: true, data: tagDeleteImpact(tag) }
  }
  /* リッチメニューを消したときの影響（PR #608）。 */
  const richMenuDeleteImpact = /^\/api\/rich-menu-groups\/([^/]+)\/delete-impact$/.exec(pathname)
  if (richMenuDeleteImpact) {
    if (query.get('visualState') === 'error') return RICH_MENU_DELETE_IMPACT_ERROR
    /*
      **参照で塞がれた下書き（`rmg-4`）だけが消せない。** ほかは消せる。
      1つの影響を全部の行へ返すと、消せるはずのメニューにも赤い理由が
      並び、どれが本当に消せないのか読めなくなる。
    */
    const impact = richMenuDeleteImpact[1] === RICH_MENU_DELETE_IMPACT.group.id
      ? RICH_MENU_DELETE_IMPACT
      : RICH_MENU_DELETE_IMPACT_EMPTY
    return { success: true, data: impact }
  }
  if (pathname === '/api/tag-groups') return { success: true, data: TAG_GROUPS }
  if (pathname === '/api/list-stats') return { success: true, data: LIST_STATS }
  if (/^\/api\/accounts\/[^/]+\/health$/.test(pathname)) {
    /*
      `{status,checks}` ではない。ダッシュボードは `logs` を数える。

      **`'ok'` ではなく `'normal'`。** 画面の `HealthRisk` は
      `'normal' | 'warning' | 'danger'` で、`'ok'` はどれにも当たらない。
      当たらないと「状態確認中」のままになり、設計の「正常稼働」と
      並べたときに**実装の差に見えてしまう**（実際はこちらの返事が違うだけ）。
    */
    return { success: true, data: { riskLevel: 'normal', logs: [] } }
  }
  if (pathname in SHAPES) {
    return { success: true, data: SHAPES[pathname] }
  }
  if (ARRAY_PATHS.has(pathname)) {
    return { success: true, data: [] }
  }
  if (ARRAY_PREFIXES.some((p) => pathname.startsWith(p))) {
    return { success: true, data: [] }
  }
  return { success: true, data: EMPTY_PAGE }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const origin = req.headers.origin ?? '*'
  const method = (req.method ?? 'GET').toUpperCase()

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  /*
    **足りないと `Failed to fetch` になる。** 画面が付けた見出しが
    ここに無いと、ブラウザが前検査で弾き、405 まで届かない。
    **実装が生のエラーを出しているように見える。**

    手動マイル調整で2回やった（`Idempotency-Key`、`X-Confirm-Irreversible`）。
    数え上げるとまた漏れるので、**聞かれたものをそのまま返す。**
    ここは画面確認用の口で、通すのは前検査だけ。
    書き込みそのものは下で405に落ちる。
  */
  const asked = req.headers['access-control-request-headers']
  res.setHeader(
    'Access-Control-Allow-Headers',
    asked || 'Content-Type, X-CSRF-Token, X-Admin-Session',
  )
  /*
    **`GET, OPTIONS` だけにしない。** 書き込みの口を撮るときに
    CORS で弾かれ、**実装が壊れているように見える。** 実際、
    フォルダの並べ替え（`PATCH /api/folders/:id`）がそれで
    「並び順を更新できませんでした」と出た。
  */
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')

  if (method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  // 更新は通さない。ここで通すと「保存できたつもり」の画像が撮れてしまい、
  // 動いていない画面を動いていると読み違える。
  //
  // ただし画面側のエラー報告だけは 204 で受ける。405 を返すと、
  // 報告が失敗したこと自体が新しいエラーになって際限なく増える。
  /*
    **数えるだけの POST は通す。** 何も保存しない口まで405にすると、
    その先の画面（配信前チェック→最終確認→予約完了）が**一度も
    描かれず、未確認のまま**になる。保存・配信の口は下でこれまでどおり
    405 に落ちる。
  */
  const READ_ONLY_POSTS = new Set(['/api/broadcasts/preflight'])
  /*
    **自動応答の確認と試験は何も保存しない。**契約が
    `stateChanged: false`（送信もタグ変更も状態更新もしない）と決めている。
    405 に落とすと、公開前チェックと試験の面が一度も撮れず未確認で残る。
    **公開（`/publish`）は保存なので通さない。**
  */
  const AUTO_REPLY_READ_ONLY =
    /^\/api\/auto-replies\/[^/]+\/(validate|test)$/.test(url.pathname)
  /*
    **公開だけは書き込みだが、通す。**通さないと `e6iJG`（有効化完了）が
    一度も撮れず、未確認のまま残る。**返すのは契約どおりの結果だけ**で、
    ここで何かが保存されるわけではない。**同じ鍵で押し直しても同じ版を返す**
    （契約の `Idempotency-Key`）ことも、この口の返り値が固定なので保たれる。
  */
  const AUTO_REPLY_PUBLISH =
    /^\/api\/auto-replies\/[^/]+\/publish$/.test(url.pathname)

  /*
    **友だち追加時配信の確認・試験・公開（PR #597）。**
    確認と試験は契約が `stateChanged: false` と決めていて何も保存しない。
    公開だけは書き込みだが、通さないと `quhg6`（有効化完了）が一度も撮れず
    未確認のまま残る。**返すのは契約どおりの固定結果だけ**で、ここで
    何かが保存されるわけではない。
  */
  const FRIEND_ADD_PUBLISH_FLOW = new Set([
    '/api/friend-add-routing/validate',
    '/api/friend-add-routing/draft/test',
    '/api/friend-add-routing/publish',
  ]).has(url.pathname)

  /*
    **「ルールをテスト」は何も保存しません。** 画面にも
    「友だちの点数や履歴は変えません」と書いてあります。405 に落とすと
    テスト結果の面が一度も撮れず、未確認のまま残ります。
    **送られてきた設定でその場で計算します。**固定の答えは返しません。
  */
  if (method === 'POST' && url.pathname === '/api/action-scores/rules/test') {
    let raw = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      let sent = {}
      try { sent = JSON.parse(raw || '{}') } catch { sent = {} }
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: testActionScoreRules(sent.configuration, {
          currentScore: sent.currentScore,
          eventType: sent.eventType,
          source: sent.source ?? null,
        }),
      }))
    })
    return
  }

  /*
    共通情報の影響確認も保存しないPOST。更新口とは分け、決まった影響の形だけを
    返す。これが無いと保存前の確認画面へ一度も進めず、未実装と誤判定する。
  */
  if (method === 'POST' && /^\/api\/common-vars\/[^/]+\/impact-preview$/.test(url.pathname)) {
    res.writeHead(200).end(JSON.stringify({ success: true, data: COMMON_VAR_IMPACT }))
    return
  }

  /*
    代理予約の登録。**ここだけは 405 に落とさない。**

    405 のままだと `予約を登録しました`（`GfceK`）と
    競合の回復（`Lg8ff`）が一度も描かれず、未確認のまま残る。

    **固定の答えは返さない。** 送られてきた `starts_at` を見て、
    Worker と同じやり方で分ける。Worker（`booking.ts:1114`）は登録の
    直前にもう一度空きを見て、埋まっていたら 409 `slot_conflict`
    を返す。空き確認と登録のあいだに他の予約が入る競り合いを、
    こちらでも同じ形で作る。

    **返す中身も Worker にあわせる**（`{ booking_id, status: 'confirmed',
    calendar_sync }` を包まずに 201、競合は `{ error: 'slot_conflict' }` を 409）。
    包んだり状態を変えたりすると、画面側の読み違いをこちらで隠してしまう。
  */
  if (method === 'POST' && url.pathname === '/api/booking/admin/bookings') {
    let raw = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      let sent = {}
      try { sent = JSON.parse(raw || '{}') } catch { sent = {} }
      const jstHHMM = new Date(sent.starts_at ?? 0).toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
      })
      if (jstHHMM === BOOKING_TAKEN_SLOT) {
        res.writeHead(409).end(JSON.stringify({ error: 'slot_conflict' }))
        return
      }
      res.writeHead(201).end(JSON.stringify({
        booking_id: '3f2b9c14-7d51-4c8a-9f60-2a1e5b7c0d83',
        status: 'confirmed',
        calendar_sync: 'not_configured',
      }))
    })
    return
  }

  /*
    一斉配信の予約取り消し。**ここも 405 に落とさない。**

    405 のままだと確認窓の先が一度も描かれず、「取り消せたのか」も
    「重なったときに何と出るのか」も未確認のまま残る。

    **固定の答えは返さない。** Worker（`broadcasts.ts:800`）と同じく
    **いまの状態を見て**分ける。`scheduled` でなければ 409。
    予約でないものを取り消そうとしたときに、画面が何と出すかを見る。

    **書き換えはしない。** 取り消した先の下書きは Worker の仕事で、
    こちらは返事の形だけをそろえる。
  */
  const cancelPath = /^\/api\/broadcasts\/([^/]+)\/cancel$/.exec(url.pathname)
  if (method === 'POST' && cancelPath) {
    const found = BROADCASTS.find((b) => b.id === cancelPath[1])
    if (!found) {
      res.writeHead(404).end(JSON.stringify({ success: false, error: 'Broadcast not found' }))
      return
    }
    if (found.status !== 'scheduled' || !found.scheduledAt) {
      res.writeHead(409).end(
        JSON.stringify({ success: false, error: 'Only scheduled broadcasts can be cancelled' }),
      )
      return
    }
    res.writeHead(200).end(JSON.stringify({
      success: true,
      data: { ...found, status: 'draft', scheduledAt: null },
    }))
    return
  }

  /*
    リマインダの公開までの口。**この3つだけは 405 に落とさない。**

    届く予定・公開前チェック・公開は、どれも `POST` だが、
    405 のままだと `JCz6J` `s6Vvp` `PSmHo` の3枚が一度も描かれない。

    **公開だけは書き込みそのもの**なので、返す中身は
    公開前チェックと同じ数（124人）から作り、別の数を作らない。
    ここで違う数を返すと、確認と完了で人数が食い違う絵になる。
  */
  const remPost = /^\/api\/reminders\/([^/]+)\/(preview|validate|publish)$/.exec(url.pathname)
  if (method === 'POST' && remPost) {
    const body = remPost[2] === 'preview' ? REMINDER_PREVIEW
      : remPost[2] === 'validate' ? REMINDER_VALIDATION
        : REMINDER_PUBLISHED
    res.writeHead(200).end(JSON.stringify({ success: true, data: body }))
    return
  }

  /*
    ひな形の保存。**この口だけは 405 に落とさない。**

    405 のままだと、下書き保存も公開も一度も通らず、
    「下書きは選択肢に出ない」「公開なら選べる」「回答先が保たれる」の
    3つを確かめられない。

    **中身は作らない。送られてきたものをそのまま返す**
    （Workerの `templates.ts:276` と同じ形）。値を作り直すと、
    保たれたのか作り直したのかが区別できなくなる。
    送られた本文は `SAVED_BODIES` に残して、あとで読めるようにする。
  */
  const tplWrite = /^\/api\/templates(?:\/([^/]+))?$/.exec(url.pathname)
  if ((method === 'POST' || method === 'PUT') && tplWrite) {
    let raw = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      let sent = {}
      try { sent = JSON.parse(raw || '{}') } catch { sent = {} }
      const id = tplWrite[1] ?? 'template-q-new'
      const saved = {
        id,
        name: sent.name ?? '',
        category: sent.category ?? '未分類',
        messageType: sent.messageType ?? 'text',
        messageContent: sent.messageContent ?? '',
        question: sent.question ?? null,
        questionStatus: sent.questionStatus ?? null,
        folderId: null, usageCount: 0, tapCount: 0, isFavorite: false,
        createdAt: '2026-08-29T03:00:00.000Z',
      }
      SAVED_TEMPLATES.set(id, saved)
      SAVED_BODIES.push({ method, path: url.pathname, body: sent })
      res.writeHead(method === 'POST' ? 201 : 200)
        .end(JSON.stringify({ success: true, data: saved }))
    })
    return
  }
  /* 送られた本文を読み出すための、撮影用のぞき口。画面からは使わない。 */
  if (method === 'GET' && url.pathname === '/__saved-bodies') {
    res.writeHead(200).end(JSON.stringify(SAVED_BODIES))
    return
  }

  /*
    **返り値が `{ status, body }` の形なら、その番号で返す。**
    権限不足（403）や見つからない（404）を撮るために要る。
    ふつうの返り値は今までどおりそのまま 200 で返す。
  */
  const send = (payload) => {
    if (payload && typeof payload === 'object' && 'status' in payload && 'body' in payload) {
      res.writeHead(payload.status).end(JSON.stringify(payload.body))
      return
    }
    res.writeHead(200).end(JSON.stringify(payload))
  }

  if (method !== 'GET') {
    if ((READ_ONLY_POSTS.has(url.pathname) || AUTO_REPLY_READ_ONLY || AUTO_REPLY_PUBLISH
      || FRIEND_ADD_PUBLISH_FLOW) && method === 'POST') {
      send(bodyFor(url.pathname, url.searchParams) ?? { success: false, error: 'not found' })
      return
    }
    if (url.pathname === '/api/client-errors') {
      res.writeHead(204).end()
      return
    }
    res.writeHead(405).end(
      JSON.stringify({ success: false, error: '画面確認用のため、更新はできません' }),
    )
    return
  }

  if (url.pathname in RAW) {
    res.writeHead(200).end(JSON.stringify(RAW[url.pathname]))
    return
  }
  send(bodyFor(url.pathname, url.searchParams))
})

/*
 * 落ちないようにする。
 *
 * 画像比較は24件を並べて走らせるので、途中で1回でも落ちると、そこから先の
 * 画面が全部ログインへ飛ぶ。そして「ログイン画面を撮って通過」になる。
 * 実際に一度そうなった（2026-08-26）。
 */
server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})
server.on('error', (error) => {
  /*
   * **ポートが埋まっているときは止まる。**
   *
   * ここで握ると、古いモックが動いたまま新しいほうが「起動した」顔をする。
   * 直したはずの中身が反映されず、しかもどこにも出ない。一度そうなった。
   */
  if (error.code === 'EADDRINUSE') {
    console.error(`[visual-qa] ${HOST}:${PORT} は使用中。先に動いているモックを止める。`)
    process.exit(1)
  }
  console.error('[visual-qa] サーバーの取りこぼし:', error.message)
})
process.on('uncaughtException', (error) => {
  console.error('[visual-qa] 落ちずに続ける:', error.message)
})

server.listen(PORT, HOST, () => {
  console.log(`[visual-qa] mock API on http://${HOST}:${PORT}（GETのみ・更新は405）`)
})
