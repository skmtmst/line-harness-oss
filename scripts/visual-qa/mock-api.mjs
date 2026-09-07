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
 * - **更新は原則失敗させる。** 画面確認専用の固定結果だけは返すが、保存も配信も起きない
 * - 実データ・秘密値を持たない。名前も固定の作り物
 * - 毎回まったく同じものを返す。乱数も時刻も使わない（画像が毎回同じになる）
 *
 * 使い方
 *   node scripts/visual-qa/mock-api.mjs            # 既定 8788番
 *   PORT=9000 node scripts/visual-qa/mock-api.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

/** このファイル自身の指紋。動いている中身が古くないかを言うために持つ。 */
const FINGERPRINT = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 16)
import { readArrayGetPaths } from './api-shapes.mjs'
import {
  MILEAGE_REWARDS,
  FORM_DELETE_IMPACT_FIXTURES,
  COMMON_VARS,
  COMMON_VAR_FOLDERS,
  COMMON_VAR_DETAIL,
  COMMON_VAR_DELETE_IMPACT,
  commonVarChangeImpact,
  COMMON_VAR_DELETE_IMPACT_EMPTY,
  COMMON_VAR_REPLACEMENT_CANDIDATES,
  COMMON_VAR_REPLACEMENT_PREVIEW,
  COMMON_VAR_REPLACEMENT_RESULT,
  MEDIA_DELETE_IMPACT,
  MEDIA_DELETE_IMPACT_EMPTY,
  MEDIA_REPLACEMENT_IMPACT,
  MEDIA_REPLACEMENT_IMPACT_BLOCKED,
  MEDIA_REPLACEMENT_IMPACT_EMPTY,
  MEDIA_FOLDERS,
  MEDIA_ITEMS,
  MEDIA_QUOTA,
  FRIEND_ADD_EVENTS,
  FRIEND_ADD_RUNS,
  FRIEND_ADD_LIFECYCLE_DRAFT,
  FRIEND_ADD_LIFECYCLE_PUBLISHED,
  FRIEND_ADD_LIFECYCLE_TEST_RESULT,
  FRIEND_ADD_LIFECYCLE_VALIDATION,
  AUTO_REPLIES, AUTO_REPLY_FOLDERS, AUTO_REPLY_RUNS, AUTO_REPLY_CONFLICT_SUMMARY,
  AUTO_REPLY_PUBLISH_CONFLICTS, AUTO_REPLY_PUBLISH_DRAFT,
  AUTO_REPLY_PUBLISH_RESULT, AUTO_REPLY_PUBLISH_TEST, AUTO_REPLY_PUBLISH_VALIDATION,
  BROADCASTS, BROADCAST_FOLDERS, BROADCAST_INSIGHTS, BROADCAST_LIST_META,
  BROADCAST_PREFLIGHT, BROADCAST_SAVED_VIEWS, CHATS, FRIEND_FIELDS, FRIEND_ATTRIBUTE_FIELDS, FRIEND_FIELD_FOLDERS,
  FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL, FRIEND_ATTRIBUTE_SAVED_SEARCH_RESPONSE, FRIEND_FIELD_MIGRATION_PREVIEW,
  INBOX_STATS, INBOX_SAVED_VIEWS, FRIEND_MESSAGES, FRIEND_MILEAGE, FRIEND_DETAILS,
  TEMPLATES, TEMPLATE_FOLDERS, TEMPLATE_TEST_RECIPIENTS,
  DUPLICATE_STATS, FRIENDS, FRIEND_BULK_RUN, FRIEND_SCENARIOS, FRIEND_STATS,
  IDENTITY_CANDIDATE_DETECTION, IDENTITY_CANDIDATE_EC, IDENTITY_CANDIDATE_ERROR, IDENTITY_CANDIDATE_FRIEND,
  IDENTITY_CANDIDATE_LISTS,
  FRIEND_SAVED_VIEWS, MERGED_PERSON_DETAIL, MERGED_PERSON_EMPTY, MERGED_PERSON_ERROR,
  LIST_STATS, NEN_BIRTHDAY_COUPON, NEN_CAMPAIGN_SETTINGS, NEN_COLUMN_CREATE, NEN_COLUMN_OPERATIONS, NEN_COLUMNS, NEN_JOBS, NEN_PETS,
  NEN_FLOW_METRICS, NEN_COLUMN_METRICS, NEN_PET_METRICS, NEN_DELIVERIES, NEN_DELIVERY_DETAILS,
  OPERATORS, REMINDERS, REMINDER_FOLDERS, SCENARIO_ACTIONS, SCENARIO_DRAFT, SCENARIO_FOLDERS, SCENARIO_STATS, SCENARIO_STEPS, SCENARIO_SIMULATION, SCENARIO_RUNS, USERS_GROUPED,
  RICH_MENU_DELETE_IMPACT, RICH_MENU_DELETE_IMPACT_EMPTY,
  RICH_MENU_GROUPS, RICH_MENU_GROUP_DETAILS, RICH_MENU_EXTERNAL, RICH_MENU_TAP_STATS,
  TAGS, TAG_GROUPS, TAG_DEFINITION_NEN_SUBSCRIPTION, TAG_DEPENDENCIES_NEN_SUBSCRIPTION,
  TAG_IMPORT_SAMPLE_ROWS, tagImportPreview, tagImportResult, REMINDER_RUNS,
  ACTION_SCORE_RULES,
  SUPPORT_MARKS, SUPPORT_MARK_ARCHIVE_IMPACT, SUPPORT_MARK_AUTOMATION_RULES,
  OUTGOING_WEBHOOKS, INCOMING_WEBHOOKS, INCOMING_WEBHOOK_DETAILS, ENTRY_ROUTES, INFLOW_SUMMARY,
  SITE_TRACKING_SUMMARY, SITE_TRACKING_PAGES, AD_PLATFORMS, AD_CONVERSION_LOGS,
  STAFF_MEMBERS, LOGIN_AUDIT,
  AFFILIATES, AFFILIATE_OFFERS, AFFILIATE_REPORT, AFFILIATE_REPORT_DETAIL, AFFILIATE_LINKS,
  AFFILIATE_SETTLEMENT_PREVIEW, AFFILIATE_SETTLEMENT_CREATED, AFFILIATE_PAYOUT_BATCH, AFFILIATE_STATEMENT,
  MILEAGE_EARNING_RULES, MILEAGE_FRIENDS, MILEAGE_HISTORY, MILEAGE_OVERVIEW,
  COMMON_ACTIONS, COMMON_ACTION_DETAIL, AUTOMATIONS, AUTOMATION_RUNS, AUTOMATION_TEMPLATES,
  BOOKING_MENUS, BOOKING_SETTINGS, BOOKING_STAFF, BOOKING_MENU_STAFF, BOOKING_AVAILABILITY, BOOKING_RESOURCES,
  BOOKING_AVAILABILITY_RULES, BOOKING_STAFF_SHIFTS, BOOKING_GOOGLE_CALENDAR,
  BOOKING_PROXY_CREATE, BOOKING_REQUESTS,
  EC_NOTIFICATION_SETTINGS, EC_NOTIFICATION_RUNS, LINE_NOTIFICATION_DEFINITIONS, LINE_NOTIFICATION_METRICS, LINE_NOTIFICATION_DELIVERIES,
  OPERATOR_NOTIFICATION_RECIPIENTS, OPERATOR_NOTIFICATION_RULES, ADMIN_EVENTS, EVENT_BOOKINGS, NEN_PHOTOS, NEN_PHOTO_DETAIL,
  NEN_PHOTO_REVIEW_METRICS, NEN_PHOTO_ASSET_STATUS, NEN_PHOTO_DERIVATIVES,
  NEN_PHOTO_ASSET_PROCESS_RESULT, NEN_PHOTO_BULK_DECISION_RESULT,
  NEN_PHOTO_PUBLICATIONS, EC_EVENTS, EC_OVERVIEW, EC_ORDERS, EC_ACTION_EXECUTIONS, EC_IDENTITY_CANDIDATES, MILEAGE_RULES,
  FORM_FOLDERS, FORMS, FORM_LIST, FORM_DETAIL, FORM_SUBMISSIONS,
  LINE_ACCOUNTS, LINE_ACCOUNT_DETAIL, LINE_ACCOUNT_VERIFY_CONNECTION, ACCOUNT_HANDOVER, ACCOUNT_HANDOVER_DECISIONS,
  CONVERSION_POINTS, CONVERSION_REPORT_CURRENT, CONVERSION_REPORT_PREVIOUS,
  CONVERSION_DEFINITIONS, CONVERSION_DEFINITION_REPORT, CONVERSION_EXPORT_CSV,
  OPERATION_CONTROL_PREVIEW, OPERATION_HEALTH, OPERATION_HISTORY,
  WEBINARS, WEBINAR_FOLDERS, WEBINAR_OVERVIEW, WEBINAR_NOTIFICATIONS, WEBINAR_CTAS, WEBINAR_ACTIONS, WEBINAR_ANALYTICS,
  FRIEND_ADD_RULE_PUBLISH, FRIEND_ADD_RULE_VALIDATE,
  ACCESS_USERS, ACCESS_ROLES, ACCESS_AUDIT_EVENTS,
  GETTING_STARTED, RECIPES, MANUAL_LINKS,
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
  /*
    **権限を持たせる。** 無いと `canRunBulk(role)` が false になり、
    友だち一覧の「操作を選ぶ」が描かれない。押しどころが無いので、
    その先の一括操作 5 状態（`IAf7j`）が1枚も撮れなかった。
    撮影用の器なので、いちばん広い `owner` を置く。
  */
  role: 'owner',
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

/** 機能9。設計の一覧・5段編集・削除確認を同じ1組の設定で撮る。 */
const FRIEND_ADD_RULE = {
  id: 'rule-referral',
  accountId: 'visual-qa-account',
  friendKind: 'first_time',
  name: '紹介キャンペーンの初回案内',
  folderName: '紹介',
  priority: 3,
  isFallback: false,
  status: 'published',
  versionId: 'rule-referral-v1',
  versionNumber: 1,
  versionStatus: 'published',
  version: 1,
  lastTestStatus: 'succeeded',
  lastTestedAt: '2026-01-13T10:00:00+09:00',
  publishedAt: '2026-01-13T10:01:00+09:00',
  matchedLast7Days: 9,
  definition: {
    routeIds: ['route-referral'],
    scenarioId: 'scenario-welcome',
    messageType: 'text',
    messageText: 'ご登録ありがとうございます。ご希望の内容をお選びください。',
    timing: 'immediate',
    actions: [
      { type: 'add_tag', label: 'タグ「新規友だち」を付ける', targetId: 'tag-new' },
      { type: 'start_scenario', label: 'シナリオ「新規登録7日間フォロー」を開始する', targetId: 'scenario-welcome' },
    ],
    friendCondition: '紹介キャンペーンから来た人へ特典を案内する。',
    activeFrom: null,
    activeUntil: null,
    weekdays: [1, 2, 3, 4, 5, 6, 0],
    timeWindows: [{ start: '08:00', end: '21:00' }],
    resendSuppressionHours: 24,
    deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
    unknownRouteAction: { sendCommonGuidance: true, notifyStaff: true },
  },
  routeNames: ['紹介キャンペーン'],
  scenarioName: '新規登録7日間フォロー',
}

const FRIEND_ADD_RULE_OPTIONS = {
  routes: [
    { id: 'route-shop', name: '店頭QRコード', kind: 'QR' },
    { id: 'route-instagram', name: 'Instagramプロフィール', kind: '広告' },
    { id: 'route-referral', name: '紹介キャンペーン', kind: '紹介' },
  ],
  scenarios: [
    { id: 'scenario-welcome', name: '新規登録7日間フォロー' },
    { id: 'scenario-common', name: '共通のあいさつ' },
  ],
  tags: [{ id: 'tag-new', name: '新規友だち' }, { id: 'tag-delivered', name: '配信済み' }],
  folders: [
    { id: 'friend-add-folder-store', name: '店頭' },
    { id: 'friend-add-folder-ads', name: '広告' },
    { id: 'friend-add-folder-referral', name: '紹介' },
  ],
}

const FRIEND_ADD_RULES = {
  items: [
    { ...FRIEND_ADD_RULE, id: 'rule-shop', name: '店頭QRの初回案内', folderName: '店頭', priority: 1, matchedLast7Days: 41, routeNames: ['店頭QRコード'], definition: { ...FRIEND_ADD_RULE.definition, routeIds: ['route-shop'], messageText: '来店クーポンをご案内します。' } },
    { ...FRIEND_ADD_RULE, id: 'rule-instagram', name: '広告からの初回案内', folderName: '広告', priority: 2, matchedLast7Days: 24, routeNames: ['Instagramプロフィール'], definition: { ...FRIEND_ADD_RULE.definition, routeIds: ['route-instagram'], messageText: '資料をダウンロードできます。' } },
    FRIEND_ADD_RULE,
    { ...FRIEND_ADD_RULE, id: 'rule-fallback', name: '経路が分からなかった人', folderName: null, priority: 999999, isFallback: true, matchedLast7Days: 12, routeNames: [], scenarioName: '共通のあいさつ', definition: { ...FRIEND_ADD_RULE.definition, routeIds: [], scenarioId: 'scenario-common', messageText: '友だち追加ありがとうございます。' } },
  ],
  summary: { rules: 4, active: 3, recentAdds: 86, captured: 74, unknownRoute: 12, delivered: 84, failed: 2 },
  options: FRIEND_ADD_RULE_OPTIONS,
  total: 4,
  nextCursor: null,
}

const FRIEND_ADD_RULE_MATCHES = new Map([
  ['rule-shop', 241],
  ['rule-instagram', 382],
  ['rule-referral', 214],
  ['rule-fallback', 12],
])

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
 * 指標カード用の7日推移。設計 `vUXKb` は全日とも有効友だち398人で、
 * 8/13だけ登録1人・流入元「検索」1人。旧グラフ用の active=4 は流用しない。
 */
const DASHBOARD_METRIC_TREND = [
  ['2026-08-13', 1, 0, 398, [{ name: '検索', count: 1 }]],
  ['2026-08-14', 0, 0, 398, []],
  ['2026-08-15', 0, 0, 398, []],
  ['2026-08-16', 0, 0, 398, []],
  ['2026-08-17', 0, 0, 398, []],
  ['2026-08-18', 0, 0, 398, []],
  ['2026-08-19', 0, 0, 398, []],
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
  // PR #1016 の未取得判別契約。値だけでなく、基準時刻と期間も本番APIとそろえる。
  metrics: {
    activeFriends: {
      value: 398,
      state: 'available',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'latest',
    },
    monthlyQuota: {
      value: { used: 3, limit: 200, remaining: 197 },
      state: 'available',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'this-month',
    },
    friendTrend: {
      value: DASHBOARD_METRIC_TREND,
      state: 'estimated',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'last7-fixed',
    },
    officialProfileUrl: {
      value: 'https://lin.ee/nen-official',
      state: 'available',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'latest',
    },
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
    isUnread: false,
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

/** 設計 `bfB50` / `oHAN4` を確認するための固定ECデータ。秘密値そのものは置かない。 */
const EC_SUBSCRIPTIONS = {
  items: [
    { id: 'sub-1', friendId: 'friend-1', ownerName: '高橋 直人', petName: 'ももちゃん', contractNumber: 'SUB-12492', status: 'active', statusLabel: 'よく続いています', riskReason: null, nextShippingAt: '2026-09-08', cycle: 'フード定期便（毎月）', items: '鹿肉フード × 2', amount: 12800, continuedCount: 10, startedAt: '2025-11-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-2', friendId: 'friend-2', ownerName: '前田 さくら', petName: 'そらくん', contractNumber: 'SUB-12503', status: 'active', statusLabel: 'よく続いています', riskReason: null, nextShippingAt: '2026-09-09', cycle: 'おやつ定期便（毎月）', items: '鹿肉ジャーキー × 1', amount: 4200, continuedCount: 8, startedAt: '2026-01-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-3', friendId: 'friend-3', ownerName: '木村 亮', petName: 'こむぎちゃん', contractNumber: 'SUB-12511', status: 'at_risk', statusLabel: '決済の確認が必要です', riskReason: '定期便のお支払いを確認できませんでした', nextShippingAt: '2026-09-12', cycle: 'フード定期便（2か月に1回）', items: '鹿肉フード × 1', amount: 8600, continuedCount: 7, startedAt: '2025-08-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-4', friendId: 'friend-4', ownerName: '中村 彩', petName: 'ぷりんちゃん', contractNumber: 'SUB-12528', status: 'paused', statusLabel: '休止中です', riskReason: null, nextShippingAt: null, cycle: 'おやつ定期便（毎月）', items: '鹿肉クッキー × 2', amount: 3600, continuedCount: 4, startedAt: '2026-05-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-5', friendId: 'friend-5', ownerName: '大西 健一', petName: 'レオくん', contractNumber: 'SUB-12532', status: 'cancelled', statusLabel: '止まりました', riskReason: null, nextShippingAt: null, cycle: 'フード定期便（毎月）', items: '鹿肉フード × 1', amount: 9800, continuedCount: 3, startedAt: '2026-05-01', cancelledAt: '2026-09-01', cancellationReason: '使いきれない', syncedAt: '2026-09-06T09:58:00+09:00' },
  ],
  summary: { total: 186, active: 172, paused: 5, atRisk: 14, cancelled: 8, monthlyAmount: 1482000, startedThisMonth: 12, cancelledThisMonth: 3, cancellationTopReason: '使いきれない', monthlyStats: [
    { month: '2026-06', count: 158, amount: 1248000 }, { month: '2026-07', count: 169, amount: 1324000 }, { month: '2026-08', count: 172, amount: 1482000 },
  ] },
  risk: { source: 'payment_status', ruleVersion: 'subscription-payment-status-v1', calculatedAt: '2026-09-06T09:58:00+09:00', predictiveScoreAvailable: false },
}

const EC_CONNECTOR = {
  configured: true,
  connector: {
    id: 'connector-visual', provider: 'shopify', shopDomain: 'nen-store.myshopify.com', status: 'connected',
    secretConfigured: true, secretLastFour: '8f3a', secretUpdatedAt: '2026-02-14T10:00:00+09:00',
    eventTypes: ['ec.order.confirmed', 'ec.order.payment_received', 'ec.order.shipped', 'ec.order.cancelled', 'ec.order.refunded', 'ec.customer.profile_updated'],
    identityRules: ['verified_email', 'verified_phone', 'manual_name_postal'], version: 3, updatedAt: '2026-09-06T09:58:00+09:00',
  },
  health: { today: 148, last30Days: 2486, failed: 2, lastReceivedAt: '2026-09-06T09:58:00+09:00', lastSucceededAt: '2026-09-06T09:58:00+09:00' },
  impact: { ...EC_OVERVIEW.impact },
  retryPolicy: '3回まで・10分あけて',
}

/**
 * パスごとの形。ここに無いものは `EMPTY_PAGE` になる。
 *
 * 画面が増えて足りなくなったら、ここに1行足す。**推測で埋めない。**
 * 実際に落ちた画面のコンソールを見て、必要な形だけを足す。
 */
/** 分析の指標1つ。`state` と `reason` を持つのが契約。 */
const METRIC = (value, state = 'available', reason = null) => ({ value, state, reason })

/*
  分析の後半3画面。空の器だけでは、行列・時系列ファネル・保存履歴を
  設計画像と比較できない。固定時刻と架空の集計結果だけを返し、保存や
  再集計そのものは行わない。
*/
const ANALYTICS_CROSS_RESULT = {
  lineAccountId: 'visual-qa-account',
  timeZone: 'Asia/Tokyo',
  rowValues: [
    { key: 'instagram', label: 'Instagram' },
    { key: 'store-qr', label: '店頭のQR' },
    { key: 'referral', label: '紹介リンク' },
    { key: 'meta', label: '広告（Meta）' },
    { key: 'unknown', label: '分からない' },
  ],
  columnValues: [
    { key: 'tagged', label: '付いている' },
    { key: 'untagged', label: '付いていない' },
  ],
  cells: [
    ['instagram', 'Instagram', 'tagged', '付いている', 86, 79],
    ['instagram', 'Instagram', 'untagged', '付いていない', 318, 306],
    ['store-qr', '店頭のQR', 'tagged', '付いている', 142, 104],
    ['store-qr', '店頭のQR', 'untagged', '付いていない', 96, 91],
    ['referral', '紹介リンク', 'tagged', '付いている', 54, 49],
    ['referral', '紹介リンク', 'untagged', '付いていない', 171, 168],
    ['meta', '広告（Meta）', 'tagged', '付いている', 31, 26],
    ['meta', '広告（Meta）', 'untagged', '付いていない', 208, 201],
    ['unknown', '分からない', 'tagged', '付いている', 12, 9],
    ['unknown', '分からない', 'untagged', '付いていない', 286, 277],
  ].map(([rowKey, rowLabel, columnKey, columnLabel, value, previousValue]) => ({
    rowKey, rowLabel, columnKey, columnLabel, value, uniqueFriends: value,
    totalRatio: value / 1404, previousValue, difference: value - previousValue,
  })),
  totalValue: 1404,
  totalFriends: 1404,
  previousTotalValue: 1310,
  periodFrom: '2026-06-06T00:00:00.000Z',
  periodTo: '2026-09-03T00:00:00.000Z',
  previousPeriodFrom: '2026-03-08T00:00:00.000Z',
  previousPeriodTo: '2026-06-05T23:59:59.999Z',
  dataCutoffAt: '2026-09-03T02:40:00.000Z',
  state: 'available',
  stateReason: null,
}

const ANALYTICS_FUNNEL_RUN = {
  runId: 'visual-funnel-run-1',
  funnelId: 'visual-funnel-1',
  versionId: 'visual-funnel-version-1',
  versionNumber: 3,
  lineAccountId: 'visual-qa-account',
  cohortFrom: '2026-06-06T00:00:00.000Z',
  cohortTo: '2026-09-03T00:00:00.000Z',
  timeZone: 'Asia/Tokyo',
  dataCutoffAt: '2026-09-03T02:40:00.000Z',
  state: 'available',
  stateReason: null,
  groups: [{
    key: 'all', label: 'すべての経路', entrants: 1404, completed: 96,
    steps: [
      { stepOrder: 1, label: '友だちになった', reached: 1404, conversionFromPrevious: null, droppedAfter: 0, inProgressAfter: 0, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
      { stepOrder: 2, label: '1回でも反応した', reached: 886, conversionFromPrevious: 0.631, droppedAfter: 518, inProgressAfter: 0, averageSecondsFromPrevious: 86400, medianSecondsFromPrevious: 72000 },
      { stepOrder: 3, label: 'フォームに答えた', reached: 412, conversionFromPrevious: 0.465, droppedAfter: 474, inProgressAfter: 0, averageSecondsFromPrevious: 172800, medianSecondsFromPrevious: 151200 },
      { stepOrder: 4, label: '予約か購入をした', reached: 238, conversionFromPrevious: 0.578, droppedAfter: 174, inProgressAfter: 0, averageSecondsFromPrevious: 259200, medianSecondsFromPrevious: 216000 },
      { stepOrder: 5, label: 'くり返し買った', reached: 96, conversionFromPrevious: 0.403, droppedAfter: 142, inProgressAfter: 0, averageSecondsFromPrevious: 604800, medianSecondsFromPrevious: 518400 },
    ],
  }],
}

const ANALYTICS_SAVED = [
  ['saved-1', '経路 × 体験申込', 'cross', '佐々木', 12, '2026-08-25T11:20:00+09:00'],
  ['saved-2', '友だちになってからの5段', 'funnel', '佐々木', 9, '2026-08-25T09:40:00+09:00'],
  ['saved-3', '広告ごとの費用対効果', 'cross', '田中', 6, '2026-08-24T18:05:00+09:00'],
  ['saved-4', 'コラムの読まれ方', 'cross', '山口', 4, '2026-08-23T14:30:00+09:00'],
  ['saved-5', 'タグ × 予約', 'cross', '田中', 21, '2026-08-12T10:15:00+09:00'],
  ['saved-6', '旧・流入の内訳', 'cross', '佐々木', 3, '2026-07-28T16:40:00+09:00'],
].map(([id, name, kind, createdByName, snapshotCount, updatedAt], index) => ({
  id, name, kind, status: 'active', currentVersionNumber: index === 5 ? 1 : 2,
  createdBy: `visual-owner-${index + 1}`, createdByName,
  createdAt: '2026-06-01T09:00:00+09:00', updatedAt, snapshotCount,
  latestSnapshot: {
    id: `${id}-snapshot-latest`, state: index === 5 ? 'unavailable' : 'available',
    periodFrom: '2026-08-05T00:00:00+09:00', periodTo: '2026-09-03T00:00:00+09:00',
    dataCutoffAt: '2026-09-03T02:40:00.000Z', createdAt: updatedAt,
  },
}))

const PENDING_APPROVALS = [
  ['木村 亮', '合同会社ノース', 'ao-2', '定期便のお申し込み', 'ECの定期が確定したとき', 5000, true],
  ['大西 健一', '合同会社ノース', 'ao-4', '資料請求', '資料請求', 1500, true],
  ['岡本 遥', '旧パートナーA（停止中）', 'ao-1', '体験の申し込み', '体験の申し込み', 3000, true],
  ['高橋 直人', '田中 明', 'ao-2', '定期便のお申し込み', 'ECの定期が確定したとき', 5000, false],
  ['藤井 理沙', '中村 彩', 'ao-1', '体験の申し込み', '体験の申し込み', 3000, false],
  ['前田 さくら', '木村 亮', 'ao-1', '体験の申し込み', '体験の申し込み', 3000, false],
  ['松本 圭', '山口 商店', 'ao-3', '友だち追加', '友だち追加', 100, false],
  ['石田 未来', '田中 明', 'ao-4', '資料請求', '資料請求', 6000, false],
].map(([friendName, affiliateName, offerId, offerName, conversionPointName, value, duplicateFlag], index) => ({
  eventId: `cv-p-${index + 1}`,
  createdAt: `2026-09-0${Math.min(index + 1, 6)}T${String(8 + index).padStart(2, '0')}:12:00+09:00`,
  friendId: `friend-${index + 1}`,
  friendName,
  affiliateId: `af-${(index % 6) + 1}`,
  affiliateName,
  offerId,
  offerName,
  offerRewardMiles: 0,
  conversionPointName,
  value,
  approvalStatus: 'pending',
  duplicateFlag,
}))

const APPROVED_APPROVALS = Array.from({ length: 34 }, (_, index) => {
  const offerIndex = index < 18 ? 1 : index < 26 ? 2 : index < 31 ? 3 : 4
  const rewards = [0, 3000, 5000, 100, 1500]
  const names = ['', '体験の申し込み', '定期便のお申し込み', '友だち追加', '資料請求']
  return {
    eventId: `cv-a-${index + 1}`,
    createdAt: `2026-09-0${(index % 6) + 1}T10:00:00+09:00`,
    friendId: `approved-friend-${index + 1}`,
    friendName: `承認済みの友だち ${index + 1}`,
    affiliateId: `af-${(index % 6) + 1}`,
    affiliateName: AFFILIATES[index % AFFILIATES.length].name,
    offerId: `ao-${offerIndex}`,
    offerName: names[offerIndex],
    offerRewardMiles: 0,
    conversionPointName: names[offerIndex],
    value: rewards[offerIndex],
    approvalStatus: 'approved',
    duplicateFlag: false,
  }
})

const REJECTED_APPROVALS = Array.from({ length: 8 }, (_, index) => ({
  ...PENDING_APPROVALS[index],
  eventId: `cv-r-${index + 1}`,
  approvalStatus: 'rejected',
  duplicateFlag: false,
}))

const CONVERSION_APPROVALS = [...PENDING_APPROVALS, ...APPROVED_APPROVALS, ...REJECTED_APPROVALS]

const SHAPES = {
  '/api/public/brand': { name: '画面確認アカウント', iconUrl: null },
  /*
    マイルの履歴。**既定の器（`{items,total,page,limit}`）では形が違う。**

    契約は `MileageAdminHistory = { items, pagination: { total, limit, offset } }`。
    口が無いと既定の器が返り、`pagination` が無いので
    `mileage-history-tab.tsx` の `result?.pagination.total` が投げ、
    **機能17の4枚が「画面を表示できませんでした」で1枚も撮れない。**
    （`?.` が `result` にしか掛かっていないのは実装側の弱さでもある。台帳に別途書いた）
  */
  /*
    行動スコア。契約は `ActionScoreOverview = { summary, items, pagination }`。
    口が無いと既定の器が返り、`action-score-tab.tsx:124` の
    `overview?.pagination.total` が投げて `z3PB2` が撮れない。
  */
  /*
    成果承認。**契約は配列**（`ConversionApprovalItem[]`）。
    `api.ts` 側のURLがテンプレート文字列（`?${qs}` を後ろに足す形）なので
    `readArrayGetPaths()` が拾えず、既定の器 `{items,total,page,limit}` が返っていた。
    そのため `tabs.tsx` の `items.map` が投げ、**`n5VVTb` が撮れなかった。**
    行が無いと「表に無い種別が内部の記号のまま出ていないか」も見られないので、
    承認待ち・承認済み・重複ありの3行を置く。
  */
  '/api/conversions/approvals': CONVERSION_APPROVALS,
  '/api/affiliate-payments': [
    { affiliateId: 'af-1', affiliateName: '田中 明', code: 'tanaka01', holdDays: 30, payoutCycle: '8/31締め・9/30払い', approvedConversions: 9, approvedReward: 84000, heldConversions: 2, heldReward: 18000, holdStatusUnknown: 0, unsettledConversions: 9, unsettledReward: 84000, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-2', affiliateName: '合同会社ノース', code: 'north', holdDays: 30, payoutCycle: '8/31締め・9/30払い', approvedConversions: 8, approvedReward: 72000, heldConversions: 1, heldReward: 12000, holdStatusUnknown: 0, unsettledConversions: 8, unsettledReward: 72000, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-3', affiliateName: '木村 亮', code: 'miyuki', holdDays: 30, payoutCycle: '8/31締め・9/30払い', approvedConversions: 7, approvedReward: 64000, heldConversions: 2, heldReward: 18000, holdStatusUnknown: 0, unsettledConversions: 7, unsettledReward: 64000, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-4', affiliateName: '中村 彩', code: 'aya-n', holdDays: 30, payoutCycle: '8/31締め・9/30払い', approvedConversions: 5, approvedReward: 42000, heldConversions: 1, heldReward: 9000, holdStatusUnknown: 0, unsettledConversions: 5, unsettledReward: 42000, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-5', affiliateName: '山口 商店', code: 'yamaguchi', holdDays: 60, payoutCycle: '8/31締め・9/30払い', approvedConversions: 5, approvedReward: 50000, heldConversions: 2, heldReward: 15000, holdStatusUnknown: 0, unsettledConversions: 5, unsettledReward: 50000, settledConversions: 0, settledReward: 0 },
  ],
  '/api/action-scores/rules': ACTION_SCORE_RULES,
  '/api/action-scores/friends': {
    summary: {
      scoredFriends: 5, high: 1, normal: 3, low: 1, decreased30d: 0,
      /* `packages/db` の `DEFAULT_BANDS` と同じ 30 / 70。40 は根拠が無く、
         決めごとの画面と一覧で同じ人が別の帯に入って見えていた。 */
      highMin: 70, normalMin: 30,
    },
    items: [
      { friendId: 'friend-1', displayName: 'さかもとまさと', currentScore: 82, band: 'high', change30d: 4, lastReason: '配信URLクリック → 夏のご案内', lastChangedAt: '2026-08-24T20:53:00+09:00' },
      { friendId: 'friend-2', displayName: 'Kyohei Yamamoto', currentScore: 55, band: 'normal', change30d: 0, lastReason: '回答フォーム回答 → 食生活アンケート', lastChangedAt: '2026-08-19T09:12:00+09:00' },
      { friendId: 'friend-3', displayName: '菅野 亮', currentScore: 31, band: 'normal', change30d: -6, lastReason: 'ブロック', lastChangedAt: '2026-08-13T20:52:00+09:00' },
      { friendId: 'friend-4', displayName: '前田 さくら', currentScore: 47, band: 'normal', change30d: 3, lastReason: 'メッセージ返信 → 配送日のご相談', lastChangedAt: '2026-08-12T18:15:00+09:00' },
      { friendId: 'friend-5', displayName: '大西 健一', currentScore: 22, band: 'low', change30d: 0, lastReason: '30日間反応なし', lastChangedAt: '2026-08-10T09:00:00+09:00' },
    ],
    pagination: { total: 5, limit: 20, offset: 0 },
  },
  /*
    分析・友だちの増減。**既定の器では `data.data` が無く、画面ごと落ちる**
    （`overview.metrics` で Cannot read properties of undefined）。
    そのため機能20の9枚が1枚も撮れなかった。

    契約は `AnalyticsEnvelope<{ state, stateReason, metrics, days, campaigns, … }>` で、
    各指標が自分の `state` と `reason` を持つ。ここでは**実測できた状態**（`available`）を返す。
    集計待ち（`pending` で `value` に 0 が入る）ときに `—` へ落ちることは
    `analytics-pending-value-contract.test.ts` が見張っている。
  */
  '/api/analytics/friends': {
    lineAccountId: 'visual-qa-account',
    timeZone: 'Asia/Tokyo',
    period: { from: '2026-08-04', to: '2026-09-02' },
    dataCutoffAt: '2026-09-02T00:00:00+09:00',
    data: {
      state: 'available',
      stateReason: null,
      metrics: {
        added: METRIC(58), removed: METRIC(11), net: METRIC(47),
        currentFriends: METRIC(1842), firstTime: METRIC(52), returning: METRIC(6),
      },
      days: [
      { date: '2026-08-04', added: 3, removed: 0, net: 3 },
      { date: '2026-08-05', added: 1, removed: 1, net: 0 },
      { date: '2026-08-06', added: 0, removed: 0, net: 0 },
      { date: '2026-08-07', added: 2, removed: 0, net: 2 },
      { date: '2026-08-08', added: 5, removed: 1, net: 4 },
      { date: '2026-08-09', added: 4, removed: 0, net: 4 },
      { date: '2026-08-10', added: 0, removed: 0, net: 0 },
      { date: '2026-08-11', added: 1, removed: 0, net: 1 },
      { date: '2026-08-12', added: 2, removed: 1, net: 1 },
      { date: '2026-08-13', added: 0, removed: 0, net: 0 },
      { date: '2026-08-14', added: 6, removed: 2, net: 4 },
      { date: '2026-08-15', added: 3, removed: 0, net: 3 },
      { date: '2026-08-16', added: 1, removed: 0, net: 1 },
      { date: '2026-08-17', added: 0, removed: 1, net: -1 },
      { date: '2026-08-18', added: 2, removed: 0, net: 2 },
      { date: '2026-08-19', added: 4, removed: 1, net: 3 },
      { date: '2026-08-20', added: 0, removed: 0, net: 0 },
      { date: '2026-08-21', added: 1, removed: 0, net: 1 },
      { date: '2026-08-22', added: 3, removed: 1, net: 2 },
      { date: '2026-08-23', added: 2, removed: 0, net: 2 },
      { date: '2026-08-24', added: 0, removed: 0, net: 0 },
      { date: '2026-08-25', added: 5, removed: 1, net: 4 },
      { date: '2026-08-26', added: 1, removed: 0, net: 1 },
      { date: '2026-08-27', added: 0, removed: 0, net: 0 },
      { date: '2026-08-28', added: 2, removed: 0, net: 2 },
      { date: '2026-08-29', added: 3, removed: 1, net: 2 },
      { date: '2026-08-30', added: 1, removed: 0, net: 1 },
      { date: '2026-08-31', added: 0, removed: 0, net: 0 },
      { date: '2026-09-01', added: 4, removed: 1, net: 3 },
      { date: '2026-09-02', added: 2, removed: 0, net: 2 },
      ],
      campaigns: [
        { id: 'bc-1', name: '8月キャンペーンのお知らせ', kind: 'broadcast', occurredAt: '2026-08-24T10:00:00+09:00', date: '2026-08-24' },
        { id: 'sc-1', name: '新しいシナリオ 8/18', kind: 'scenario', occurredAt: '2026-08-18T18:30:00+09:00', date: '2026-08-18' },
      ],
      historyAvailableFrom: '2026-08-04',
    },
  },
  /* 分析・配信の反応。`AnalyticsReactionsOverview`。 */
  '/api/analytics/reactions': {
    lineAccountId: 'visual-qa-account', timeZone: 'Asia/Tokyo',
    period: { from: '2026-08-04', to: '2026-09-02' }, dataCutoffAt: '2026-09-02T00:00:00+09:00',
    data: {
      metrics: {
        sent: METRIC(1842), delivered: METRIC(1836), opened: METRIC(1274),
        lineClicked: METRIC(318), trackedClicks: METRIC(204),
        unavailableCampaigns: METRIC(1, 'partial', '20人未満の配信は開封を取得できません'),
      },
      campaigns: [
        {
          id: 'bc-1', name: '8月キャンペーンのお知らせ', kind: 'broadcast', sentAt: '2026-08-24T10:00:00+09:00',
          targetPeople: METRIC(624), delivered: METRIC(624), opened: METRIC(438),
          lineClicked: METRIC(112), outcomes: METRIC(9), fetchedAt: '2026-08-25T03:00:00+09:00',
        },
        {
          id: 'bc-2', name: '予約空き枠のご案内', kind: 'broadcast', sentAt: '2026-08-18T18:30:00+09:00',
          targetPeople: METRIC(203), delivered: METRIC(203), opened: METRIC(141),
          lineClicked: METRIC(37), outcomes: METRIC(2), fetchedAt: '2026-08-19T03:00:00+09:00',
        },
        {
          id: 'sc-1', name: '新しいシナリオ 8/18', kind: 'scenario', sentAt: '2026-08-18T09:00:00+09:00',
          targetPeople: METRIC(18), delivered: METRIC(18),
          opened: METRIC(null, 'insufficient', '20人未満のため取得できません'),
          lineClicked: METRIC(3), outcomes: METRIC(0), fetchedAt: null,
        },
      ],
      trackedClickHours: [
        { hour: 9, clicks: 22 }, { hour: 10, clicks: 48 }, { hour: 12, clicks: 31 },
        { hour: 18, clicks: 57 }, { hour: 20, clicks: 46 },
      ],
      clickDefinition: 'クリック率は「そのURLを含む配信が届いた人数」に対する割合です。同じ人が複数回押しても、実人数は1として数えます。',
    },
  },
  /* 分析・経路と成果。`AnalyticsRoutesOverview`。 */
  '/api/analytics/routes': {
    lineAccountId: 'visual-qa-account', timeZone: 'Asia/Tokyo',
    period: { from: '2026-08-04', to: '2026-09-02' }, dataCutoffAt: '2026-09-02T00:00:00+09:00',
    data: {
      attributionModel: 'first_touch',
      attributionLabel: '最初に触れた経路',
      routes: [
        {
          id: 'rt-1', refCode: 'sns-aug', name: 'SNSの8月投稿',
          clicks: METRIC(412), friendAdds: METRIC(38), currentFriends: METRIC(35), reactionPeople: METRIC(21),
          conversions: { approved: METRIC(4), pending: METRIC(1), rejected: METRIC(0), revenue: METRIC(48000) },
          adCost: METRIC(12000), costPerFriend: METRIC(315), costPerConversion: METRIC(3000), profitAfterAdCost: METRIC(36000),
        },
        {
          id: 'rt-2', refCode: null, name: '代理店A',
          clicks: METRIC(97), friendAdds: METRIC(6), currentFriends: METRIC(6), reactionPeople: METRIC(2),
          conversions: { approved: METRIC(0), pending: METRIC(0), rejected: METRIC(0), revenue: METRIC(0) },
          adCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'),
          costPerFriend: METRIC(null, 'unavailable', '広告費が無いので出せません'),
          costPerConversion: METRIC(null, 'unavailable', '広告費が無いので出せません'),
          profitAfterAdCost: METRIC(null, 'unavailable', '広告費が無いので出せません'),
        },
      ],
      searchConsoleHref: 'https://search.google.com/search-console',
    },
  },
  /* 分析・使われ方。`AnalyticsUsageOverview`。 */
  '/api/analytics/usage': {
    lineAccountId: 'visual-qa-account', timeZone: 'Asia/Tokyo',
    period: { from: '2026-08-04', to: '2026-09-02' }, dataCutoffAt: '2026-09-02T00:00:00+09:00',
    data: {
      state: 'available', stateReason: null,
      checkedAt: '2026-09-02T00:00:00+09:00', automaticDeletion: false,
      summary: {
        unusedItems: METRIC(79), automaticRuns: METRIC(214), manualSends: METRIC(12), estimatedHoursSaved: METRIC(1),
      },
      categories: [
        { key: 'templates', label: 'テンプレート', href: '/templates', created: METRIC(0), inUse: METRIC(0), unused: METRIC(0), brokenReferences: METRIC(0), lastUsedAt: METRIC(null, 'unavailable', 'まだ使われていません') },
        { key: 'scenarios', label: 'シナリオ', href: '/scenarios', created: METRIC(11), inUse: METRIC(11), unused: METRIC(0), brokenReferences: METRIC(0), lastUsedAt: METRIC('2026-08-26') },
        { key: 'forms', label: '回答フォーム', href: '/form-submissions', created: METRIC(8, 'partial', '回答実績から確認できるフォームのみです'), inUse: METRIC(5, 'partial', '回答実績から確認できるフォームのみです'), unused: METRIC(3, 'partial', '回答実績から確認できるフォームのみです'), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC('2026-08-29', 'partial', '回答実績から確認できるフォームのみです') },
        { key: 'rich_menus', label: 'リッチメニュー', href: '/rich-menus', created: METRIC(4), inUse: METRIC(2), unused: METRIC(2), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC('2026-08-30') },
        { key: 'friend_attributes', label: 'タグ・友だち情報', href: '/tags', created: METRIC(101, 'partial', '旧共通項目を含みます'), inUse: METRIC(22, 'partial', '旧共通項目を含みます'), unused: METRIC(79, 'partial', '旧共通項目を含みます'), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC('2026-08-24', 'partial', '旧共通項目を含みます') },
        { key: 'inflow_conversion', label: '流入リンク・成果地点', href: '/inflow-links', created: METRIC(16), inUse: METRIC(9), unused: METRIC(7), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC('2026-08-31') },
        { key: 'automations', label: 'オートメーション・共通アクション', href: '/automations', created: METRIC(7), inUse: METRIC(3), unused: METRIC(4), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC('2026-09-01') },
        { key: 'media_vars', label: '登録メディア・共通情報', href: '/contents', created: METRIC(null, 'unavailable', '旧データにLINEアカウント所属がありません'), inUse: METRIC(null, 'unavailable', '旧データにLINEアカウント所属がありません'), unused: METRIC(null, 'unavailable', '旧データにLINEアカウント所属がありません'), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC(null, 'unavailable', '旧データにLINEアカウント所属がありません') },
      ],
    },
  },
  /*
    分析・定期レポート作成。予約が0件でも、選択肢は本物と同じ器で返す。
    これが無いと保存済み分析と受信者を選べず、設計 `URqOA` を撮れない。
  */
  '/api/analytics/report-schedules': {
    items: [],
    options: {
      timeZone: 'Asia/Tokyo',
      savedAnalyses: [
        { id: 'saved-route', name: '経路別の成果', kind: 'cross' },
      ],
      recipients: [
        {
          id: 'staff-owner', name: '佐々木 亮太', role: 'admin',
          email: 'sasaki@example.com', lineLinked: true,
        },
        {
          id: 'staff-operator', name: '山本 京子', role: 'staff',
          email: 'yamamoto@example.com', lineLinked: true,
        },
      ],
    },
  },
  '/api/mileage/rewards': MILEAGE_REWARDS,
  '/api/mileage/history': MILEAGE_HISTORY,
  '/api/settings/features': {
    features: FEATURES,
    sidebarOrder: null,
    sidebarItemOrder: null,
    parentChildMode: false,
    specializedFeatureKeys: ['nen_campaigns', 'photo_review', 'ec_commerce', 'line_notifications'],
  },
  '/api/inbox/unanswered/count': { total: 0, byAccount: [], oldestWaitMinutes: null },
  // 設計 `vUXKb` の「写真審査 1件 確認待ち」。0で返すとカードが空のまま撮れる。
  '/api/nen-members/overview': { pets: 6, healthLogs: 12, activeCare: 2, pendingPhotos: 3, members: 6, consultations: 1 },
  /*
   * 一斉配信の帯（設計 `q76C35`）。**型どおりに返す。**
   * ここが無かったせいで、一覧の帯が「予約中 undefined」「失敗 undefined」
   * のまま撮れていた。返事が無いと別の形（items/total）へ落ちて、
   * 画面はそれを数として読もうとする。`BroadcastStats` と同じ形にする。
   */
  '/api/broadcasts/stats': {
    thisMonth: 12,
    scheduled: 4,
    delivered: 1842,
    failed: 0,
    openRate: 69.4,
  },
  '/api/friends/stats': FRIEND_STATS,
  '/api/friends': { items: FRIENDS, total: 231, page: 1, limit: 20 },
  '/api/users-grouped': USERS_GROUPED,
  '/api/duplicates/stats': DUPLICATE_STATS,
  '/api/operators': OPERATORS,
  '/api/scenarios': FRIEND_SCENARIOS,
  '/api/media': MEDIA_ITEMS,
  '/api/media/quota': MEDIA_QUOTA,

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
  '/api/rich-menu-groups/external': RICH_MENU_EXTERNAL,
  '/api/rich-menu-groups/tap-stats': RICH_MENU_TAP_STATS,

  /* 友だち追加時配信の公開前確認（PR #597）。契約と同じ形を返す。 */
  '/api/friend-add-routing/draft': FRIEND_ADD_LIFECYCLE_DRAFT,
  '/api/friend-add-routing/conflicts': { conflicts: [] },

}

/**
 * 画面確認だけで完結する、保存を伴わない固定の返事。
 * 本番データは変更せず、毎回同じ結果を返す。ほかの更新は従来どおり405。
 */
function visualQaWriteBody(method, pathname) {
  if (method === 'POST' && pathname === '/api/notifications/operator-rules/recipients-preview') {
    return OPERATOR_NOTIFICATION_RECIPIENTS
  }
  if (method === 'POST' && /^\/api\/notifications\/operator-rules\/[^/]+\/(publish|test)$/.test(pathname)) {
    return { accepted: 2, excluded: 0, failed: 0, duplicate: 0 }
  }
  const scenarioSimulation = /^\/api\/scenarios\/([^/]+)\/simulate$/.exec(pathname)
  if (method === 'POST' && scenarioSimulation) {
    return { ...SCENARIO_SIMULATION, scenarioId: scenarioSimulation[1] }
  }
  if (method === 'PUT' && /^\/api\/scenarios\/[^/]+\/draft$/.test(pathname)) return SCENARIO_DRAFT
  if (method === 'POST' && /^\/api\/scenarios\/[^/]+\/test-send$/.test(pathname)) return { sent: 1 }
  if (method === 'POST' && /^\/api\/scenarios\/[^/]+\/steps\/[^/]+\/test-send$/.test(pathname)) return { sent: 1 }
  if (method === 'POST' && pathname === '/api/ec-commerce/test-send') return { sent: 1 }
  if (method === 'PUT' && /^\/api\/manual-links\/[^/]+$/.test(pathname)) {
    const key = decodeURIComponent(pathname.split('/').pop() ?? '')
    return MANUAL_LINKS.items.find((item) => item.key === key) ?? null
  }
  if (method === 'POST' && /^\/api\/recipes\/[^/]+\/clone$/.test(pathname)) {
    return { runId: 'visual-recipe-clone-run', status: 'succeeded', createdCount: 16, items: [] }
  }
  if (method === 'POST' && pathname === '/api/manual-links/check') {
    return { checked: 265, ok: 263, broken: 2, unset: 1 }
  }
  if (method === 'POST' && pathname === '/api/line-accounts/verify-connection') {
    return LINE_ACCOUNT_VERIFY_CONNECTION
  }
  if (method === 'POST' && /^\/api\/friend-add-rules\/[^/]+\/validate$/.test(pathname)) {
    return FRIEND_ADD_RULE_VALIDATE
  }
  if (method === 'POST' && /^\/api\/friend-add-rules\/[^/]+\/publish$/.test(pathname)) {
    return FRIEND_ADD_RULE_PUBLISH
  }
  if (method === 'POST' && /^\/api\/friend-fields\/[^/]+\/migration-preview$/.test(pathname)) {
    return FRIEND_FIELD_MIGRATION_PREVIEW
  }
  if (method === 'POST' && pathname === '/api/inbox/saved-views') {
    return {
      id: 'inbox-view-preview',
      name: '未割り当て・期限超過',
      createdBy: 'Kenta',
      isShared: false,
      matchCount: 1,
    }
  }
  if (method === 'POST' && pathname === '/api/broadcasts/saved-views') {
    return BROADCAST_SAVED_VIEWS[0]
  }
  if (method === 'POST' && pathname === '/api/analytics/cross/query') {
    return { id: 'visual-cross-result-1', state: 'pending' }
  }
  if (method === 'POST' && /^\/api\/auto-replies\/[^/]+\/test$/.test(pathname)) {
    return AUTO_REPLY_PUBLISH_TEST
  }
  if (method === 'POST' && /^\/api\/auto-replies\/[^/]+\/validate$/.test(pathname)) {
    return AUTO_REPLY_PUBLISH_VALIDATION
  }
  if (method === 'POST' && /^\/api\/auto-replies\/[^/]+\/publish$/.test(pathname)) {
    return AUTO_REPLY_PUBLISH_RESULT
  }
  if (method === 'POST' && /^\/api\/rich-menu-groups\/[^/]+\/preview-targets$/.test(pathname)) {
    return {
      matched: { value: 1020, state: 'available', reason: null },
      overlap: { value: 180, state: 'available', reason: null },
      effective: { value: 840, state: 'available', reason: null },
      higherMenus: ['夏キャンペーン'],
      priority: 2,
    }
  }
  if (method === 'POST' && pathname === '/api/friend-add-rules/test') {
    return {
      stateChanged: false, ruleId: FRIEND_ADD_RULE.id, matched: true,
      reasons: ['この設定が優先順位どおりに選ばれます。'],
      scenarioId: FRIEND_ADD_RULE.definition.scenarioId,
      message: FRIEND_ADD_RULE.definition.messageText,
      actions: FRIEND_ADD_RULE.definition.actions,
    }
  }
  if (method === 'POST' && pathname === '/api/broadcasts/preflight') {
    return BROADCAST_PREFLIGHT
  }
  if (method === 'POST' && pathname === '/api/friend-add-routing/validate') {
    return FRIEND_ADD_LIFECYCLE_VALIDATION
  }
  if (method === 'POST' && pathname === '/api/friend-add-routing/draft/test') {
    return FRIEND_ADD_LIFECYCLE_TEST_RESULT
  }
  if (method === 'POST' && pathname === '/api/friend-add-routing/publish') {
    return FRIEND_ADD_LIFECYCLE_PUBLISHED
  }
  if (method === 'POST' && pathname === '/api/saved-searches/preview') {
    return FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL
  }
  return null
}

/** `success` の器に入れず、そのまま返すもの。 */
const RAW = {
  // `0.0.0-dev` のときはバナー自体を出さない。manifest も見に行かない。
  //（update-banner.tsx の DEV_VERSION と同じ値でないと効かない）
  '/admin/version': { version: '0.0.0-dev', worker_hash: '', admin_hash: '', liff_hash: '' },
  '/admin/manifest': { releases: [], versions: [] },

  /*
    **`{success, data}` で包まない口。**

    `api.ts` には `fetchApi<{ menus: BookingMenu[] }>` のように、
    器を通さずそのまま返る口がある。包んで返すと画面側は
    `res.menus` が `undefined` になり、`.filter` で丸ごと落ちる。

      /booking/menus  … Cannot read properties of undefined (reading 'filter')
      /events         … 同上

    どちらも「画面を表示できませんでした」になっていて、
    **実装の不具合に見えていた。**
  */
  /* 空いている時間。包むと `res.by_staff` が undefined になり、選ぶ口が0件になる。 */
  '/api/booking/admin/availability': BOOKING_AVAILABILITY,
  '/api/booking/admin/resources': { resources: BOOKING_RESOURCES },
  '/api/booking/admin/menus': { menus: BOOKING_MENUS },
  '/api/booking/admin/staff': { staff: BOOKING_STAFF },
  '/api/events/admin/events': { items: ADMIN_EVENTS },
  // 予約メニューの帯は `requests` から件数を出す。包むと `.filter` で落ちる。
  '/api/booking/admin/requests': { requests: BOOKING_REQUESTS },
}

/**
 * 同じく包まない口のうち、**途中にIDが入るもの**。
 *
 * `RAW` は道が一致したときしか効かないので、
 * `/api/events/admin/events/ev-1/bookings` のように id が挟まる口は
 * 素通りして `{success,data:{items…}}` に包まれていた。
 * 画面は `listRes.items` を読むので `undefined` になり、
 * `29-1-B 申込者の一覧` が `.filter` で「画面を表示できませんでした」になっていた。
 */
const RAW_PATTERNS = [
  [/^\/api\/events\/admin\/events\/[^/]+\/bookings$/, (url) => ({
    items: url.searchParams.get('status')
      ? EVENT_BOOKINGS.filter((booking) => booking.status === url.searchParams.get('status'))
      : EVENT_BOOKINGS,
  })],
  /* メニューに就ける担当。器は `{staff}`。包むと選ぶ口が0件になる。 */
  [/^\/api\/booking\/admin\/menus\/[^/]+\/staff$/, { staff: BOOKING_MENU_STAFF }],
  /* `tksPc` の通常・読込中・失敗を分けるため、通常だけ本番と同じ器で返す。 */
  [/^\/api\/booking\/admin\/staff\/[^/]+\/shifts$/, { shifts: BOOKING_STAFF_SHIFTS }],
  [/^\/api\/booking\/admin\/staff\/[^/]+\/availability-rules$/, { rules: BOOKING_AVAILABILITY_RULES }],
  [/^\/api\/booking\/admin\/staff\/[^/]+\/google-calendar$/, BOOKING_GOOGLE_CALENDAR],
]

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

const NEN_RANGE_END = Date.parse('2026-08-25T15:00:00.000Z')

function nenRangeFor(query) {
  const from = query.get('from')
  const to = query.get('to')
  if (from && to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to))) {
    return {
      days: Math.max(1, Math.ceil((Date.parse(to) - Date.parse(from)) / 86_400_000)),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    }
  }
  const requested = Number.parseInt(query.get('days') ?? '30', 10)
  const days = Number.isSafeInteger(requested) && requested >= 1 && requested <= 365 ? requested : 30
  return {
    days,
    from: new Date(NEN_RANGE_END - days * 86_400_000).toISOString(),
    to: new Date(NEN_RANGE_END).toISOString(),
  }
}

function nenMetricsBody(data, query) {
  return { ...data, range: nenRangeFor(query) }
}

function bodyFor(pathname, query = new URLSearchParams()) {
  if (pathname === '/api/auth/session') {
    return { success: true, data: STAFF, csrfToken: 'visual-qa-csrf' }
  }
  if (pathname === '/api/affiliate-settlements/preview') {
    return { success: true, data: AFFILIATE_SETTLEMENT_PREVIEW }
  }
  if (pathname === '/api/ec-commerce/orders') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const filtered = EC_ORDERS.items.filter((order) => {
      if (status && order.status !== status) return false
      if (!search) return true
      return order.orderNumber.toLocaleLowerCase('ja').includes(search)
        || (order.customerName ?? '').toLocaleLowerCase('ja').includes(search)
    })
    const total = status || search ? filtered.length : EC_ORDERS.total
    return {
      success: true,
      data: { ...EC_ORDERS, items: filtered.slice(offset, offset + limit), total },
      pagination: { total, limit, offset },
    }
  }
  if (pathname === '/api/ec-commerce/action-executions') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status')
    const eventId = query.get('eventId')
    const filtered = EC_ACTION_EXECUTIONS.items.filter((execution) => (
      (!status || execution.status === status) && (!eventId || execution.eventId === eventId)
    ))
    const total = status || eventId ? filtered.length : EC_ACTION_EXECUTIONS.total
    return {
      success: true,
      data: { ...EC_ACTION_EXECUTIONS, items: filtered.slice(offset, offset + limit), total },
      pagination: { total, limit, offset },
    }
  }
  if (pathname === '/api/ec-commerce/identity-candidates') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status') ?? 'pending'
    const filtered = EC_IDENTITY_CANDIDATES.items.filter((candidate) => candidate.status === status)
    const total = status === 'pending' ? EC_IDENTITY_CANDIDATES.total : filtered.length
    return {
      success: true,
      data: { ...EC_IDENTITY_CANDIDATES, items: filtered.slice(offset, offset + limit), total },
      pagination: { total, limit, offset },
    }
  }
  if (pathname === '/api/access/users') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status')
    const roleBundle = query.get('roleBundle')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const filtered = ACCESS_USERS.items.filter((user) => {
      if (status && user.status !== status) return false
      if (roleBundle && user.roleBundle !== roleBundle) return false
      if (!search) return true
      return user.name.toLocaleLowerCase('ja').includes(search)
        || (user.email ?? '').toLocaleLowerCase('ja').includes(search)
    })
    return {
      success: true,
      data: {
        ...ACCESS_USERS,
        items: filtered.slice(offset, offset + limit),
        pagination: { total: filtered.length, limit, offset },
      },
    }
  }
  if (pathname === '/api/access/roles') return { success: true, data: ACCESS_ROLES }
  if (pathname === '/api/audit/events') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const category = query.get('category')
    const result = query.get('result')
    const actorId = query.get('actorId')
    const action = query.get('action')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const from = query.get('from') ? Date.parse(query.get('from')) : null
    const to = query.get('to') ? Date.parse(query.get('to')) : null
    const filtered = ACCESS_AUDIT_EVENTS.items.filter((event) => {
      if (category && event.category !== category) return false
      if (result && event.result !== result) return false
      if (actorId && event.actor.id !== actorId) return false
      if (action && event.action !== action) return false
      const createdAt = Date.parse(event.createdAt)
      if (Number.isFinite(from) && createdAt < from) return false
      if (Number.isFinite(to) && createdAt > to) return false
      if (!search) return true
      return [event.actor.name, event.action, event.target?.kind, event.target?.id, event.reason]
        .some((value) => String(value ?? '').toLocaleLowerCase('ja').includes(search))
    })
    const hasFilter = Boolean(category || result || actorId || action || search || Number.isFinite(from) || Number.isFinite(to))
    const total = hasFilter ? filtered.length : ACCESS_AUDIT_EVENTS.pagination.total
    return {
      success: true,
      data: {
        ...ACCESS_AUDIT_EVENTS,
        items: filtered.slice(offset, offset + limit),
        pagination: { total, limit, offset },
      },
    }
  }
  if (pathname === '/api/getting-started') return { success: true, data: GETTING_STARTED }
  if (pathname === '/api/recipes') return { success: true, data: RECIPES }
  const recipeDetail = /^\/api\/recipes\/([^/]+)$/.exec(pathname)
  if (recipeDetail) {
    return { success: true, data: RECIPES.find((recipe) => recipe.id === recipeDetail[1]) ?? null }
  }
  if (pathname === '/api/manual-links') return { success: true, data: MANUAL_LINKS }
  if (pathname === '/api/operations/control/preview') {
    return { success: true, data: OPERATION_CONTROL_PREVIEW }
  }
  if (pathname === '/api/operations/health') {
    return { success: true, data: OPERATION_HEALTH }
  }
  if (pathname === '/api/operations/history') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0
      ? requestedLimit
      : OPERATION_HISTORY.length
    return { success: true, data: OPERATION_HISTORY.slice(0, limit) }
  }
  if (pathname === '/api/analytics/cross/results/visual-cross-result-1') {
    return {
      success: true,
      data: {
        id: 'visual-cross-result-1', state: 'available', errorCode: null,
        result: ANALYTICS_CROSS_RESULT, createdAt: '2026-09-03T02:40:00.000Z',
      },
    }
  }
  if (pathname === '/api/analytics/funnels') {
    return {
      success: true,
      data: [{
        id: 'visual-funnel-1', name: '友だちになってからの5段', windowDays: 30,
        createdAt: '2026-06-01T09:00:00+09:00',
        currentVersion: { id: 'visual-funnel-version-1', versionNumber: 3, createdAt: '2026-08-20T09:00:00+09:00' },
        migrationState: 'ready',
      }],
    }
  }
  if (pathname === '/api/analytics/funnels/visual-funnel-1/runs/latest') {
    return { success: true, data: ANALYTICS_FUNNEL_RUN }
  }
  if (pathname === '/api/analytics/saved') {
    return { success: true, data: ANALYTICS_SAVED }
  }
  const savedSnapshots = /^\/api\/analytics\/saved\/([^/]+)\/snapshots$/.exec(pathname)
  if (savedSnapshots) {
    const saved = ANALYTICS_SAVED.find((item) => item.id === savedSnapshots[1])
    return {
      success: true,
      data: saved ? [0, 1, 2].map((offset) => ({
        id: `${saved.id}-snapshot-${offset + 1}`, savedAnalysisId: saved.id,
        analysisVersionId: `${saved.id}-version-${saved.currentVersionNumber}`,
        sourceKind: saved.kind, sourceResultId: `visual-result-${offset + 1}`,
        periodFrom: `2026-0${Math.max(6, 8 - offset)}-05T00:00:00+09:00`,
        periodTo: `2026-0${Math.max(7, 9 - offset)}-03T00:00:00+09:00`,
        timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-09-03T02:40:00.000Z',
        state: offset === 2 ? 'partial' : 'available', result: {},
        createdBy: saved.createdBy, createdAt: saved.updatedAt,
      })) : [],
    }
  }
  if (pathname === '/api/conversions/approvals') {
    const status = query.get('status')
    return {
      success: true,
      data: status ? CONVERSION_APPROVALS.filter((item) => item.approvalStatus === status) : CONVERSION_APPROVALS,
    }
  }
  if (pathname === `/api/line-accounts/${ACCOUNT.id}/handovers`) {
    return { success: true, data: [ACCOUNT_HANDOVER] }
  }
  if (pathname === `/api/account-handovers/${ACCOUNT_HANDOVER.id}`) {
    return {
      success: true,
      data: { ...ACCOUNT_HANDOVER, decisions: ACCOUNT_HANDOVER_DECISIONS, unresolvedReviews: 20 },
    }
  }
  if (pathname.startsWith('/api/line-accounts/') && pathname.split('/').length === 4) {
    /*
      1件を返す口。**詳細（★V6 33-3）が読む。**
      資格情報は「入っているか」だけを返す（値そのものは返さない）。
      これが無いと、詳細の資格情報タブが全部「入っていません」になり、
      **実装の不具合に見えてしまう。**
    */
    return {
      success: true,
      data: {
        ...(LINE_ACCOUNTS.find((account) => account.id === pathname.split('/')[3]) ?? LINE_ACCOUNT_DETAIL),
        ...(pathname.split('/')[3] === LINE_ACCOUNT_DETAIL.id ? LINE_ACCOUNT_DETAIL : {}),
      },
    }
  }
  if (pathname === '/api/line-accounts') {
    /*
      `webhook` を付ける。無いと接続状態カードが「確認中」のままで、
      設計の「正常」と並べたときに実装の差に見えてしまう。
    */
    return { success: true, data: LINE_ACCOUNTS }
  }
  if (pathname === '/api/friends/migrations') {
    return { success: true, data: [{
      id: 'visual-uid-run', fromAccountId: ACCOUNT.id, toAccountId: 'visual-qa-account-new',
      purpose: '友だち情報・タグ・配信停止状態を新アカウントへ引き継ぐ', sourceKind: 'csv',
      sourceFilename: 'uid-map-2026-09-06.csv', status: 'review', dryRunRevision: 1,
      counts: { total: 5214, auto: 4982, review: 34, unmatched: 195, conflict: 3, applied: 0, failed: 0 },
      createdBy: STAFF.id, approvedBy: null, createdAt: '2026-09-06T05:20:00.000Z',
      reviewedAt: null, executedAt: null, completedAt: null, rolledBackAt: null, failureReason: null,
    }] }
  }
  if (pathname === '/api/friends/migrations/visual-uid-run') {
    return { success: true, data: {
      id: 'visual-uid-run', fromAccountId: ACCOUNT.id, toAccountId: 'visual-qa-account-new',
      purpose: '友だち情報・タグ・配信停止状態を新アカウントへ引き継ぐ', sourceKind: 'csv',
      sourceFilename: 'uid-map-2026-09-06.csv', status: 'review', dryRunRevision: 1,
      counts: { total: 5214, auto: 4982, review: 34, unmatched: 195, conflict: 3, applied: 0, failed: 0 },
      createdBy: STAFF.id, approvedBy: null, createdAt: '2026-09-06T05:20:00.000Z',
      reviewedAt: null, executedAt: null, completedAt: null, rolledBackAt: null, failureReason: null,
      items: [
        { id: 'uid-item-1', oldUid: 'old_uid_00291', newUid: 'new_uid_00291', candidateName: 'Kyohei Yamamoto', evidenceType: 'operator_csv', classification: 'review', conflictReason: '2アカウントに候補があります', decision: 'pending', result: 'pending', errorMessage: null },
        { id: 'uid-item-2', oldUid: 'old_uid_00412', newUid: 'new_uid_00412', candidateName: '山田 太郎', evidenceType: 'operator_csv', classification: 'conflict', conflictReason: '新旧UIDが別の統合ユーザーに結び付いています', decision: 'pending', result: 'pending', errorMessage: null },
        { id: 'uid-item-3', oldUid: 'old_uid_01180', newUid: null, candidateName: null, evidenceType: 'operator_csv', classification: 'unmatched', conflictReason: '移行先に一致する友だちがいません', decision: 'pending', result: 'pending', errorMessage: null },
      ],
    } }
  }
  if (pathname === '/api/friends/migration-jobs') {
    return { success: true, data: [
      { id: 'import-1', kind: 'import', line_account_id: ACCOUNT.id, total_count: 231, update_count: 34, conflict_count: 3, status: 'completed', created_by_name: '河野 健太', created_at: '2026-09-03T05:20:00.000Z' },
      { id: 'import-2', kind: 'import', line_account_id: ACCOUNT.id, total_count: 231, update_count: 34, conflict_count: 3, status: 'previewed', created_by_name: '河野 健太', created_at: '2026-09-03T02:05:00.000Z' },
      { id: 'export-1', kind: 'export', line_account_id: ACCOUNT.id, row_count: 231, status: 'expired', created_by_name: '坂本 真人', created_at: '2026-09-02T10:40:00.000Z', expires_at: '2026-09-09T10:40:00.000Z' },
    ] }
  }
  if (pathname === '/api/friend-add-rules') {
    return { success: true, data: FRIEND_ADD_RULES }
  }
  if (pathname === '/api/friend-add-rules/conflicts') {
    return {
      success: true,
      data: {
        conflicts: [],
        rules: FRIEND_ADD_RULES.items.map((rule) => ({
          id: rule.id,
          name: rule.name,
          priority: rule.priority,
          weekdays: rule.definition.weekdays ?? [],
          timeWindows: rule.definition.timeWindows ?? [],
          friendCondition: rule.definition.friendCondition || null,
          matchedLast28Days: FRIEND_ADD_RULE_MATCHES.get(rule.id) ?? 0,
        })),
      },
    }
  }
  if (/^\/api\/friend-add-rules\/[^/]+$/.test(pathname)) {
    return {
      success: true,
      data: {
        rule: FRIEND_ADD_RULE,
        options: FRIEND_ADD_RULE_OPTIONS,
        staffNotification: { status: 'connected', reason: null },
      },
    }
  }
  if (pathname === '/api/identity-candidates/detect') {
    return {
      success: true,
      data: query.get('visualState') === 'empty'
        ? IDENTITY_CANDIDATE_DETECTION.empty
        : IDENTITY_CANDIDATE_DETECTION.normal,
    }
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
  const friendDuplicate = /^\/api\/friends\/duplicates\/([^/]+)$/.exec(pathname)
  if (friendDuplicate) {
    if (query.get('visualState') === 'error') return IDENTITY_CANDIDATE_ERROR
    return { success: true, data: IDENTITY_CANDIDATE_FRIEND }
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
    if (row) {
      const friend = FRIEND_DETAILS[row.friendId]
      return {
        success: true,
        data: {
          ...row,
          friendRealName: friend?.realName ?? null,
          isAttention: friend?.metadata?.__attention === '1',
          messages: FRIEND_MESSAGES[row.friendId] ?? [],
        },
      }
    }
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
  if (pathname === '/api/templates') return { success: true, data: TEMPLATES }
  const templateDetail = /^\/api\/templates\/(template-\d+)$/.exec(pathname)
  if (templateDetail) {
    const template = TEMPLATES.find((item) => item.id === templateDetail[1])
    if (template) {
      const usedBy = template.id === 'template-9' ? {
        scenarioSteps: [{ scenarioId: 'scenario-welcome', scenarioName: '新規登録7日間フォロー', stepId: 'step-1', stepOrder: 1 }],
        autoReplies: [{ id: 'auto-reply-document', keyword: '資料請求', matchType: 'exact', lineAccountId: 'visual-qa-account' }],
        automations: [{ id: 'automation-inbox-favorite', name: '受信箱の「よく使う」（担当3人が登録）', eventType: 'inbox_favorite' }],
        reminderSteps: [], richMenuAreas: [], trackedLinks: [],
      } : {
        autoReplies: [], automations: [], scenarioSteps: [], reminderSteps: [], richMenuAreas: [], trackedLinks: [],
      }
      return { success: true, data: { ...template, accountId: 'visual-qa-account', question: null, questionStatus: 'draft', usedBy } }
    }
  }
  if (pathname === '/api/account-settings/test-recipients') {
    return { success: true, data: TEMPLATE_TEST_RECIPIENTS }
  }
  if (pathname === '/api/forms') {
    return { success: true, data: query.get('with_list_summary') === '1' ? FORM_LIST : FORMS }
  }
  if (pathname === `/api/forms/${FORM_DETAIL.id}`) return { success: true, data: FORM_DETAIL }
  const formSubmissions = new RegExp(`^/api/forms/${FORM_DETAIL.id}/submissions$`).test(pathname)
  if (formSubmissions) {
    const page = Number.parseInt(query.get('page') ?? '1', 10)
    const limit = Number.parseInt(query.get('limit') ?? '20', 10)
    const safePage = Number.isInteger(page) && page > 0 ? page : 1
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20
    const start = (safePage - 1) * safeLimit
    return { success: true, data: { ...FORM_SUBMISSIONS, items: FORM_SUBMISSIONS.items.slice(start, start + safeLimit), page: safePage, limit: safeLimit } }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'form') {
    return { success: true, data: FORM_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'template') {
    return { success: true, data: TEMPLATE_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'broadcast') {
    return { success: true, data: BROADCAST_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'scenario') {
    return { success: true, data: SCENARIO_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'reminder') {
    return { success: true, data: REMINDER_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'friend_field') {
    return { success: true, data: FRIEND_FIELD_FOLDERS }
  }
  if (pathname === '/api/friend-fields') {
    // 機能4は利用人数つきの一覧を要求する。他機能の選択肢は従来データを保つ。
    return { success: true, data: query.get('withUsage') === '1' ? FRIEND_ATTRIBUTE_FIELDS : FRIEND_FIELDS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'auto_reply') {
    return { success: true, data: AUTO_REPLY_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'common_var') {
    return { success: true, data: COMMON_VAR_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'media') {
    return { success: true, data: MEDIA_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'webinar') {
    return { success: true, data: WEBINAR_FOLDERS }
  }
  if (pathname === '/api/booking/admin/settings') {
    return { success: true, data: BOOKING_SETTINGS }
  }
  if (pathname === '/api/auto-replies') return { success: true, data: AUTO_REPLIES }
  if (pathname === '/api/auto-replies/conflicts') {
    return { success: true, data: AUTO_REPLY_CONFLICT_SUMMARY }
  }
  if (pathname === '/api/auto-reply-runs') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    return {
      success: true,
      data: {
        ...AUTO_REPLY_RUNS,
        items: AUTO_REPLY_RUNS.items.slice(offset, offset + limit),
        pagination: { total: AUTO_REPLY_RUNS.items.length, limit, offset },
      },
    }
  }
  if (/^\/api\/auto-replies\/[^/]+\/draft$/.test(pathname)) {
    return { success: true, data: AUTO_REPLY_PUBLISH_DRAFT }
  }
  if (/^\/api\/auto-replies\/[^/]+\/conflicts$/.test(pathname)) {
    return { success: true, data: { conflicts: AUTO_REPLY_PUBLISH_CONFLICTS } }
  }
  const autoReplyOne = /^\/api\/auto-replies\/([^/]+)$/.exec(pathname)
  if (autoReplyOne) {
    const found = AUTO_REPLIES.find((item) => item.id === autoReplyOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/reminders') return { success: true, data: REMINDERS }
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
  if (pathname === '/api/friend-add-routing/events') {
    const kind = query.get('kind')
    const attributionStatus = query.get('attribution_status')
    const routingStatus = query.get('routing_status')
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0
      ? requestedLimit
      : FRIEND_ADD_EVENTS.items.length
    const items = FRIEND_ADD_EVENTS.items
      .filter((item) => !kind || item.kind === kind)
      .filter((item) => !attributionStatus || item.attributionStatus === attributionStatus)
      .filter((item) => !routingStatus || item.routingStatus === routingStatus)
      .slice(0, limit)
    return { success: true, data: { ...FRIEND_ADD_EVENTS, items } }
  }
  if (pathname === '/api/friend-add-runs') {
    const status = query.get('status')
    const ruleId = query.get('rule_id')
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 20
    const items = FRIEND_ADD_RUNS.items
      .filter((item) => !status || item.status === status)
      .filter((item) => !ruleId || item.rule?.id === ruleId)
      .slice(0, limit)
    return { success: true, data: { ...FRIEND_ADD_RUNS, items } }
  }
  if (/^\/api\/scenarios\/[^/]+\/stats$/.test(pathname)) return { success: true, data: SCENARIO_STATS }
  if (/^\/api\/scenarios\/[^/]+\/simulate$/.test(pathname)) return { success: true, data: SCENARIO_SIMULATION }
  if (/^\/api\/scenarios\/[^/]+\/runs$/.test(pathname)) return { success: true, data: SCENARIO_RUNS }
  if (/^\/api\/scenarios\/[^/]+\/draft$/.test(pathname)) return { success: true, data: SCENARIO_DRAFT }
  const scenarioActions = pathname.match(/^\/api\/scenarios\/([^/]+)\/actions$/)
  if (scenarioActions) {
    return {
      success: true,
      data: SCENARIO_ACTIONS
        .filter((action) => action.scenarioId === scenarioActions[1])
        .sort((left, right) => left.sortOrder - right.sortOrder),
    }
  }
  const scenario = pathname.match(/^\/api\/scenarios\/([^/]+)$/)
  if (scenario) {
    // 通を配列で返す。`{items,total}` のままだと `scenario.steps` で落ちる。
    const row = FRIEND_SCENARIOS.find((r) => r.id === scenario[1]) ?? FRIEND_SCENARIOS[0]
    return { success: true, data: { ...row, steps: SCENARIO_STEPS.map((step) => ({ ...step, scenarioId: row.id })) } }
  }
  if (pathname === '/api/broadcasts/saved-views') {
    return { success: true, data: BROADCAST_SAVED_VIEWS }
  }
  const broadcastInsight = pathname.match(/^\/api\/broadcasts\/([^/]+)\/insight$/)
  if (broadcastInsight) {
    return { success: true, data: BROADCAST_INSIGHTS[broadcastInsight[1]] ?? null }
  }
  const broadcastOne = pathname.match(/^\/api\/broadcasts\/([^/]+)$/)
  if (broadcastOne) {
    const found = BROADCASTS.find((item) => item.id === broadcastOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/broadcasts') {
    return { success: true, data: BROADCASTS, ...BROADCAST_LIST_META }
  }
  if (pathname === '/api/inbox/saved-views') return { success: true, data: INBOX_SAVED_VIEWS }
  if (pathname === '/api/friends/saved-views') {
    const id = query.get('id')
    if (id) {
      const item = FRIEND_SAVED_VIEWS.items.find((view) => view.id === id)
      return item
        ? { success: true, data: item }
        : { success: false, error: '保存した検索が見つかりません' }
    }
    return { success: true, data: FRIEND_SAVED_VIEWS }
  }
  if (pathname === '/api/chats') return { success: true, data: CHATS }
  if (pathname === '/api/chats/stats') return { success: true, data: INBOX_STATS }
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
  /* リマインダの実行結果（設計 `GC4St` 7-1-H）。絞り込みと検索もここで効かせる。 */
  if (/^\/api\/reminders\/[^/]+\/runs$/.test(pathname)) {
    const status = query.get('status')
    const search = (query.get('search') ?? '').trim()
    let items = REMINDER_RUNS.items
    if (status) items = items.filter((run) => run.domainStatus === status)
    if (search) items = items.filter((run) => (run.friendName ?? '').includes(search))
    return {
      success: true,
      data: { ...REMINDER_RUNS, items, pagination: { ...REMINDER_RUNS.pagination, total: items.length } },
    }
  }
  if (pathname === '/api/tags') return { success: true, data: TAGS }
  const tagDependencies = /^\/api\/tags\/([^/]+)\/dependencies$/.exec(pathname)
  if (tagDependencies) {
    return {
      success: true,
      data: {
        ...TAG_DEPENDENCIES_NEN_SUBSCRIPTION,
        tag: { ...TAG_DEPENDENCIES_NEN_SUBSCRIPTION.tag, id: tagDependencies[1] },
      },
    }
  }
  const tagDefinition = /^\/api\/tags\/([^/]+)$/.exec(pathname)
  if (tagDefinition) {
    const tag = { ...TAG_DEFINITION_NEN_SUBSCRIPTION.tag, id: tagDefinition[1] }
    return query.get('withActions') === '1'
      ? { success: true, data: { ...TAG_DEFINITION_NEN_SUBSCRIPTION, ...tag, tag } }
      : { success: true, data: tag }
  }
  if (pathname === '/api/support-marks') return { success: true, data: SUPPORT_MARKS }
  if (/^\/api\/support-marks\/[^/]+\/archive-impact$/.test(pathname)) {
    return { success: true, data: SUPPORT_MARK_ARCHIVE_IMPACT }
  }
  if (pathname === '/api/saved-searches' && query.get('format') !== 'segment_v1') {
    return FRIEND_ATTRIBUTE_SAVED_SEARCH_RESPONSE
  }
  const savedSearchDetail = /^\/api\/saved-searches\/([^/]+)$/.exec(pathname)
  if (savedSearchDetail) {
    return {
      success: true,
      data: { ...FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL, id: savedSearchDetail[1] },
    }
  }
  /* 自動変更ルール（設計 `GMvBd` 4-3-A）。マークごとに返す。 */
  if (/^\/api\/support-marks\/[^/]+\/automation-rules$/.test(pathname)) {
    return { success: true, data: SUPPORT_MARK_AUTOMATION_RULES }
  }
  /*
    いま入っている人。34-1「はじめの設定」の最終確認が役割で言い分けるので、
    一覧の形（items/total）ではなく 1 人ぶんを返す。
  */
  /*
    友だち追加時の振り分け。34-1 の段3・段4 がこれを読む。
    下書きはあるが公開していない——設計 `RAW35` が「止まっています」で
    描いている状態を、そのまま固定データにする。
  */
  if (pathname === '/api/friend-add-routing')
    return {
      success: true,
      data: {
        configured: true,
        routing: {
          firstTime: { scenarioId: 'visual-qa-scenario', actions: [], timing: 'immediate' },
          returning: { scenarioId: null, actions: [], mode: 'none', startPosition: 'start' },
          criteria: { firstTime: 'never_added' },
        },
        scenarios: [{ id: 'visual-qa-scenario', name: '新規登録 7日間フォロー' }],
        tags: [],
      },
    }
  if (pathname === '/api/friend-add-routing/draft')
    return {
      success: true,
      data: {
        accountId: 'visual-qa-account',
        versionId: 'visual-qa-draft',
        versionNumber: 1,
        status: 'draft',
        routing: {
          firstTime: { scenarioId: 'visual-qa-scenario', actions: [], timing: 'immediate' },
          returning: { scenarioId: null, actions: [], mode: 'none', startPosition: 'start' },
          criteria: { firstTime: 'never_added' },
        },
        lastTestStatus: null,
        lastTestedAt: null,
        publishedAt: null,
      },
    }
  if (pathname === '/api/staff/me')
    return {
      success: true,
      data: {
        id: 'visual-qa-staff',
        name: 'Kenta Kawano',
        email: null,
        role: 'owner',
        permissionKeys: [],
        isActive: true,
      },
    }
  const formDeleteImpact = /^\/api\/forms\/([^/]+)\/delete-impact$/.exec(pathname)
  if (formDeleteImpact) {
    const data = formDeleteImpact[1] === 'form-empty'
      ? FORM_DELETE_IMPACT_FIXTURES.delete
      : FORM_DELETE_IMPACT_FIXTURES.archive
    return { success: true, data }
  }
  if (pathname === '/api/friends/bulk-runs/friend-bulk-run-1') {
    return { success: true, data: FRIEND_BULK_RUN.detail }
  }
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
  /*
    外部連携・流入経路・ログインユーザー。**空だと一覧の中身を設計と比べられない。**
    `readArrayGetPaths()` はこれらを配列の口として拾うが、返す中身が無かったので
    どの画面も「まだありません」の絵しか撮れず、34画面が空のままだった。
  */
  /*
    いま入っている人。**これが無いと「管理者かどうか」が false になる。**
    `staff/page.tsx` の `canEdit` は `administrator` を見ていて、
    行の「範囲を編集」も「ユーザーを追加」も出なくなる。
    既定の器が返っていたので、固定データを足しても押し口が出なかった。
  */
  if (pathname === '/api/staff/me') {
    return { success: true, data: { id: STAFF.id, name: STAFF.name, role: STAFF.role, email: null } }
  }
  if (pathname === '/api/webhooks/outgoing') return { success: true, data: OUTGOING_WEBHOOKS }
  const incomingWebhookDetail = /^\/api\/webhooks\/incoming\/([^/]+)$/.exec(pathname)
  if (incomingWebhookDetail) {
    const detail = INCOMING_WEBHOOK_DETAILS[incomingWebhookDetail[1]]
    return detail
      ? { success: true, data: detail }
      : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/webhooks/incoming') return { success: true, data: INCOMING_WEBHOOKS }
  if (pathname === '/api/entry-routes') return { success: true, data: ENTRY_ROUTES }
  if (pathname === '/api/entry-route-genres') {
    return { success: true, data: ['SNS', '紹介', '店頭', '広告', 'メール', '紙'].map((name, index) => ({ id: `erg-${index + 1}`, name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' })) }
  }
  if (pathname === '/api/site/summary') return { success: true, data: SITE_TRACKING_SUMMARY }
  if (pathname === '/api/site/pages') return { success: true, data: SITE_TRACKING_PAGES }
  if (pathname === '/api/ad-platforms') return { success: true, data: AD_PLATFORMS }
  const adPlatformLogs = /^\/api\/ad-platforms\/([^/]+)\/logs$/.exec(pathname)
  if (adPlatformLogs) {
    return { success: true, data: AD_CONVERSION_LOGS.filter((log) => log.adPlatformId === adPlatformLogs[1]) }
  }
  /*
    流入元の詳細。可変部分を配列の既定値へ落とすと、1件取得まで `[]` になり、
    `route.createdAt.slice(...)` で詳細画面全体が落ちる。画面確認用の同じ1件から
    詳細・段階・参照元を組み立て、一覧と右側で別のリンクを見せない。
  */
  const entryRouteFunnel = /^\/api\/entry-routes\/([^/]+)\/funnel$/.exec(pathname)
  if (entryRouteFunnel) {
    return {
      success: true,
      data: { click_count: 1240, friend_add_count: 86, form_submission_count: 36, cv_count: 12 },
    }
  }
  const entryRouteSources = /^\/api\/entry-routes\/([^/]+)\/sources$/.exec(pathname)
  if (entryRouteSources) {
    return {
      success: true,
      data: [
        { label: 'instagram.com', count: 312 },
        { label: 'lin.ee', count: 96 },
        { label: '直接アクセス', count: 78 },
      ],
    }
  }
  const entryRouteDetail = /^\/api\/entry-routes\/([^/]+)$/.exec(pathname)
  if (entryRouteDetail) {
    const entryRoute = ENTRY_ROUTES.find((item) => item.id === entryRouteDetail[1])
    return entryRoute
      ? { success: true, data: entryRoute }
      : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/analytics/ref-summary') {
    return { success: true, data: INFLOW_SUMMARY }
  }
  if (/^\/api\/analytics\/ref\/[^/]+$/.test(pathname)) {
    return {
      success: true,
      data: {
        friends: [
          { id: 'friend-inflow-1', displayName: '石田 未来', trackedAt: '2026-08-25T09:12:00.000Z', firstPage: '/summer-campaign', currentStatus: 'やりとり中', conversion: 'まだありません', miles: 100 },
          { id: 'friend-inflow-2', displayName: '新田 遥', trackedAt: '2026-08-24T21:40:00.000Z', firstPage: '/summer-campaign', currentStatus: 'シナリオ2通目', conversion: 'まだありません', miles: 100 },
          { id: 'friend-inflow-3', displayName: '松本 圭', trackedAt: '2026-08-22T12:05:00.000Z', firstPage: '/profile', currentStatus: '体験を申し込んだ', conversion: '¥3,000 の成果', miles: 600 },
          { id: 'friend-inflow-4', displayName: '林 里佳', trackedAt: '2026-08-20T18:22:00.000Z', firstPage: '/summer-campaign', currentStatus: 'ブロックされました', conversion: 'まだありません', miles: 100 },
          { id: 'friend-inflow-5', displayName: '大村 真', trackedAt: '2026-08-18T10:44:00.000Z', firstPage: '/summer-campaign', currentStatus: '読んでいない', conversion: 'まだありません', miles: 100 },
        ],
      },
    }
  }
  if (pathname === '/api/staff') return { success: true, data: STAFF_MEMBERS }
  if (pathname === '/api/login-audit') return { success: true, data: LOGIN_AUDIT }

  /*
    紹介者・案件・マイル・成果地点。**空だと一覧の中身を設計と比べられない。**

    `/api/mileage/overview` は器の形まで要る。画面の `isMileageAdminOverview` は
    `summary` の5つの数と `pagination` を見ていて、1つでも欠けると
    「友だちのマイルを表示できませんでした」に落ちる。
  */
  if (pathname === '/api/affiliates') return { success: true, data: AFFILIATES }
  if (pathname === '/api/affiliate-offers') return { success: true, data: AFFILIATE_OFFERS }
  if (pathname === '/api/common-actions') {
    const status = query.get('status')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const filtered = COMMON_ACTIONS
      .filter((item) => status === 'old_version'
        ? item.oldVersionBindingCount > 0
        : status === 'unused'
          ? item.status === 'published' && item.bindingCount === 0
          : status ? item.status === status : true)
      .filter((item) => !search || `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('ja').includes(search))
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : null
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    return {
      success: true,
      data: limit === null ? filtered : filtered.slice(offset, offset + limit),
      pagination: { total: filtered.length, limit, offset },
      freshness: 'available',
    }
  }
  if (pathname === '/api/automations') return {
    success: true,
    data: AUTOMATIONS,
    summary: {
      active: AUTOMATIONS.filter((item) => item.status === 'active').length,
      stopped: AUTOMATIONS.filter((item) => item.status === 'stopped').length,
      executionCount30d: AUTOMATIONS.reduce((sum, item) => sum + item.executionCount30d, 0),
      failureCount30d: AUTOMATIONS.reduce((sum, item) => sum + item.failureCount30d, 0),
    },
    freshness: 'available',
  }
  if (pathname === '/api/automation-draft-resources') return {
    success: true,
    data: {
      tags: [{ id: 'tag-trial', name: '体験申込' }, { id: 'tag-member', name: '会員' }],
      scenarios: [{ id: 'scenario-trial', name: '体験前フォロー' }],
    },
  }
  if (pathname === '/api/automation-runs') return { success: true, data: AUTOMATION_RUNS }
  if (pathname === '/api/automation-templates') return { success: true, data: AUTOMATION_TEMPLATES }
  if (pathname === '/api/ec-commerce/settings') return { success: true, data: EC_NOTIFICATION_SETTINGS }
  if (pathname === '/api/line-notifications/customer-definitions') {
    return { success: true, data: LINE_NOTIFICATION_DEFINITIONS }
  }
  if (pathname === '/api/line-notifications/metrics') {
    return { success: true, data: LINE_NOTIFICATION_METRICS }
  }
  if (pathname === '/api/line-notifications/deliveries') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const items = query.get('view') === 'failures'
      ? LINE_NOTIFICATION_DELIVERIES.items.filter((item) => item.status === 'failed')
      : LINE_NOTIFICATION_DELIVERIES.items
    return { success: true, data: { ...LINE_NOTIFICATION_DELIVERIES, items: items.slice(offset, offset + limit) }, pagination: { total: items.length, limit, offset } }
  }
  if (pathname === '/api/notifications/operator-rules') {
    return { success: true, data: { items: OPERATOR_NOTIFICATION_RULES, summary: { total: 11, published: 9, stopped: 2, missingRecipients: 1, recipients: 6, acceptedToday: 42, excludedToday: 1 } } }
  }
  if (pathname === '/api/ec-commerce/notification-runs') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    return {
      success: true,
      data: {
        ...EC_NOTIFICATION_RUNS,
        items: EC_NOTIFICATION_RUNS.items.slice(offset, offset + limit),
      },
      pagination: { total: EC_NOTIFICATION_RUNS.items.length, limit, offset },
    }
  }
  if (pathname === '/api/nen-members/photos') return { success: true, data: NEN_PHOTOS }
  if (pathname === '/api/nen-members/photos/review-metrics') {
    return { success: true, data: NEN_PHOTO_REVIEW_METRICS }
  }
  if (pathname === '/api/nen-members/photos/publications') return { success: true, data: NEN_PHOTO_PUBLICATIONS }
  const photoAssetStatus = /^\/api\/nen-members\/photos\/([^/]+)\/assets\/status$/.exec(pathname)
  if (photoAssetStatus) {
    return {
      success: true,
      data: {
        ...NEN_PHOTO_ASSET_STATUS,
        jobs: NEN_PHOTO_ASSET_STATUS.jobs.map((job) => ({ ...job, photoId: photoAssetStatus[1] })),
      },
    }
  }
  if (/^\/api\/nen-members\/photos\/[^/]+\/assets\/derivatives$/.test(pathname)) {
    return { success: true, data: NEN_PHOTO_DERIVATIVES }
  }
  if (/^\/api\/nen-members\/photos\/[^/]+$/.test(pathname)) return { success: true, data: NEN_PHOTO_DETAIL }
  if (pathname === '/api/ec-commerce/overview') return { success: true, data: EC_OVERVIEW }
  /* 取り込みの記録。ページ送りの数を器の外に持つ口。 */
  if (pathname === '/api/ec-commerce/events') {
    return { success: true, data: EC_EVENTS, pagination: { total: EC_EVENTS.length, limit: 20, offset: 0 } }
  }
  if (pathname === '/api/ec-commerce/subscriptions') {
    return { success: true, data: EC_SUBSCRIPTIONS, pagination: { total: EC_SUBSCRIPTIONS.summary.total, limit: 100, offset: 0 } }
  }
  if (pathname === '/api/ec-commerce/connector') return { success: true, data: EC_CONNECTOR }
  if (pathname === '/api/affiliates-report') return { success: true, data: AFFILIATE_REPORT }
  const affiliateArchiveImpact = /^\/api\/affiliates\/([^/]+)\/archive-impact$/.exec(pathname)
  if (affiliateArchiveImpact) {
    const affiliate = AFFILIATES.find((item) => item.id === affiliateArchiveImpact[1]) ?? AFFILIATES[0]
    return {
      success: true,
      data: {
        affiliateId: affiliate.id,
        affiliateName: affiliate.name,
        lifecycle: affiliate.isActive ? 'active' : 'paused',
        activeLinks: 3,
        unsettledConversions: 9,
        unsettledReward: 24000,
        pendingConversions: 2,
        checkedAt: '2026-09-06T00:00:00.000Z',
      },
    }
  }
  const affiliatePaymentPreview = /^\/api\/affiliate-payments\/([^/]+)\/preview$/.exec(pathname)
  if (affiliatePaymentPreview) {
    const affiliate = AFFILIATES.find((item) => item.id === affiliatePaymentPreview[1]) ?? AFFILIATES[1]
    return {
      success: true,
      data: {
        affiliateId: affiliate.id,
        affiliateName: affiliate.name,
        code: affiliate.code,
        amount: 72000,
        conversionCount: 18,
        periodFrom: '2026-08-01T00:00:00+09:00',
        periodTo: '2026-08-31T23:59:59+09:00',
        closeDate: null,
        paymentDate: null,
        bankDestination: null,
        breakdown: [
          { offerName: '定期便のはじめて購入', conversions: 8, unitReward: 5000, subtotal: 40000 },
          { offerName: '無料体験の申込', conversions: 9, unitReward: 3000, subtotal: 27000 },
          { offerName: '友だち追加だけ', conversions: 50, unitReward: 100, subtotal: 5000 },
        ],
      },
    }
  }
  /* 紹介者ひとりぶん。`/api/affiliates/:id/report` と `/links`。器の形が要る。 */
  if (/^\/api\/affiliates\/[^/]+\/report$/.test(pathname)) return { success: true, data: AFFILIATE_REPORT_DETAIL }
  if (/^\/api\/affiliates\/[^/]+\/links$/.test(pathname)) return { success: true, data: AFFILIATE_LINKS }
  if (pathname === '/api/mileage/overview') return { success: true, data: MILEAGE_OVERVIEW }
  if (pathname === '/api/mileage/friends') return { success: true, data: MILEAGE_FRIENDS }
  if (pathname === '/api/mileage/earning-rules') return { success: true, data: MILEAGE_EARNING_RULES }
  if (pathname === '/api/mileage/rules') return { success: true, data: MILEAGE_RULES }
  if (pathname === '/api/mileage/adjustment-policy') {
    return { success: true, data: { configured: true, approvalThreshold: 10_000 } }
  }
  if (/^\/api\/mileage\/rewards\/[^/]+$/.test(pathname)) {
    const rewardId = pathname.split('/').pop()
    const reward = MILEAGE_REWARDS.rewards.find((item) => item.id === rewardId)
    return reward
      ? { success: true, data: reward }
      : { success: false, error: '使い道が見つかりません' }
  }
  if (pathname === '/api/conversions/definitions') return { success: true, data: CONVERSION_DEFINITIONS }
  if (pathname === '/api/conversions/points') return { success: true, data: CONVERSION_POINTS }
  if (pathname === '/api/conversions/report') {
    if (query.has('from') || query.has('to')) {
      return { success: true, data: CONVERSION_DEFINITION_REPORT }
    }
    const startDate = query.get('startDate') ?? ''
    const data = startDate >= '2026-08-01'
      ? CONVERSION_REPORT_CURRENT
      : CONVERSION_REPORT_PREVIOUS
    return { success: true, data }
  }
  if (pathname === '/api/common-vars') return { success: true, data: COMMON_VARS }
  if (pathname === `/api/common-vars/${COMMON_VAR_DETAIL.id}`) return { success: true, data: COMMON_VAR_DETAIL }
  const commonVarDeleteImpact = /^\/api\/common-vars\/([^/]+)\/delete-impact$/.exec(pathname)
  if (commonVarDeleteImpact) {
    const impact = commonVarDeleteImpact[1] === COMMON_VAR_DELETE_IMPACT_EMPTY.variable.id
      ? COMMON_VAR_DELETE_IMPACT_EMPTY
      : COMMON_VAR_DELETE_IMPACT
    return { success: true, data: impact }
  }
  const mediaDeleteImpact = /^\/api\/media\/([^/]+)\/delete-impact$/.exec(pathname)
  if (mediaDeleteImpact) {
    const impact = mediaDeleteImpact[1] === MEDIA_DELETE_IMPACT_EMPTY.media.id
      ? MEDIA_DELETE_IMPACT_EMPTY
      : MEDIA_DELETE_IMPACT
    return { success: true, data: impact }
  }
  const mediaReplacementImpact = /^\/api\/media\/([^/]+)\/replacement-impact$/.exec(pathname)
  if (mediaReplacementImpact) {
    if (query.get('replacementId') === 'media-delete-target') {
      return { success: true, data: MEDIA_REPLACEMENT_IMPACT_BLOCKED }
    }
    const impact = mediaReplacementImpact[1] === MEDIA_REPLACEMENT_IMPACT_EMPTY.source.id
      ? MEDIA_REPLACEMENT_IMPACT_EMPTY
      : MEDIA_REPLACEMENT_IMPACT
    return { success: true, data: impact }
  }
  const richMenuDeleteImpact = /^\/api\/rich-menu-groups\/([^/]+)\/delete-impact$/.exec(pathname)
  if (richMenuDeleteImpact) {
    const impact = richMenuDeleteImpact[1] === RICH_MENU_DELETE_IMPACT_EMPTY.group.id
      ? RICH_MENU_DELETE_IMPACT_EMPTY
      : RICH_MENU_DELETE_IMPACT
    return { success: true, data: impact }
  }
  if (pathname === '/api/rich-menu-groups') {
    return { success: true, data: RICH_MENU_GROUPS }
  }
  if (pathname === '/api/rich-menu-groups/external') {
    return { success: true, data: RICH_MENU_EXTERNAL }
  }
  if (pathname === '/api/rich-menu-groups/tap-stats') {
    return { success: true, data: RICH_MENU_TAP_STATS }
  }
  const richMenuGroup = /^\/api\/rich-menu-groups\/([^/]+)$/.exec(pathname)
  if (richMenuGroup) {
    const group = RICH_MENU_GROUP_DETAILS[richMenuGroup[1]]
    return group
      ? { success: true, data: group }
      : { success: false, error: 'リッチメニューが見つかりません' }
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
  if (pathname === '/api/notifications/center') {
    /*
      ダッシュボードの通知パネル。**器の形が合わないと画面が落ちる。**
      `isDashboardNotificationData` が `items` と `counts.{all,error,update,unread}`
      と `unreadCount` を見ていて、既定の器（空配列）だと通らず
      「通知を読み込めませんでした」になっていた。
      中身は設計 `Alekb` の6件をそのまま置く。
    */
    const item = (id, category, title, body, isRead, createdAt) => ({
      id, eventType: `visual_qa.${category}`, category, title, body,
      metadata: null, isRead, createdAt,
    })
    const items = [
      item('nc-1', 'error', '一斉配信「8月号のご案内」で12件が送信失敗', '配信結果を開く', false, '2026-09-02T01:04:00.000Z'),
      item('nc-2', 'error', 'LINE Webhook の応答遅延を検知しました', '運用状態を開く', false, '2026-08-21T09:32:00.000Z'),
      item('nc-3', 'error', 'EC連携の取り込みが3件失敗しています', 'EC連携を開く', false, '2026-08-21T00:15:00.000Z'),
      item('nc-4', 'update', 'v0.25 の更新が利用できます', '更新履歴を見る', false, '2026-08-20T00:00:00.000Z'),
      item('nc-5', 'update', 'v0.24.1 を適用しました', '更新履歴を見る', true, '2026-08-14T00:00:00.000Z'),
      item('nc-6', 'update', 'メンテナンス予定　8/30 2:00〜4:00', '詳細を見る', true, '2026-08-12T00:00:00.000Z'),
    ]
    const category = query.get('category')
    const shown = category && category !== 'all' ? items.filter((x) => x.category === category) : items
    return {
      success: true,
      data: {
        items: shown,
        counts: {
          all: items.length,
          error: items.filter((x) => x.category === 'error').length,
          update: items.filter((x) => x.category === 'update').length,
          unread: items.filter((x) => !x.isRead).length,
        },
        unreadCount: items.filter((x) => !x.isRead).length,
      },
    }
  }
  if (pathname === '/api/analytics/url-clicks') {
    /*
      分析のURLクリック。**入れ子の器で返す。**
      画面は `state.data.data` と読む（`period` は外側にある）。
      ほかの分析タブと同じ形。既定の器だと `overview.stateReason` で落ちて、
      画面が丸ごと「画面を表示できませんでした」になっていた。
    */
    return {
      success: true,
      data: {
        lineAccountId: 'visual-qa-account',
        timeZone: 'Asia/Tokyo',
        period: { from: '2026-08-05', to: '2026-09-03' },
        dataCutoffAt: '2026-09-03T00:00:00+09:00',
        data: {
          state: 'available',
          stateReason: null,
          clickRateDefinition: 'クリック率は「実人数 ÷ 届いた人数」で出しています。',
          links: [
            {
              trackedLinkId: 'tl-1', name: '定期便の案内', originalUrl: 'https://example.com/subscription',
              isActive: true, clicks: METRIC(482), knownClickPeople: METRIC(311),
              deliveredPeople: METRIC(1_842), clickRate: METRIC(16.9),
              usageLocations: ['一斉配信「9月の定期便」', 'リッチメニュー「メインA」'],
            },
            {
              trackedLinkId: 'tl-2', name: '来店クーポン', originalUrl: 'https://example.com/coupon',
              isActive: false, clicks: METRIC(96), knownClickPeople: METRIC(74),
              deliveredPeople: METRIC(640), clickRate: METRIC(11.6),
              usageLocations: [],
            },
          ],
        },
      },
    }
  }
  if (pathname === '/api/nen-campaigns/settings') return { success: true, data: NEN_CAMPAIGN_SETTINGS }
  if (pathname === '/api/nen-campaigns/columns') return { success: true, data: NEN_COLUMNS }
  if (pathname === '/api/nen-campaigns/columns-preview') {
    const targetMode = query.get('targetMode') === 'tag' ? 'tag' : 'all'
    return {
      success: true,
      data: targetMode === 'tag'
        ? NEN_COLUMN_OPERATIONS.audience
        : { count: 1_284, targetMode: 'all', targetTagId: null },
    }
  }
  if (pathname === '/api/nen-campaigns/pets') return { success: true, data: NEN_PETS }
  if (pathname === '/api/nen-campaigns/jobs') return { success: true, data: NEN_JOBS }
  if (pathname === '/api/nen-campaigns/metrics/flows') return { success: true, data: nenMetricsBody(NEN_FLOW_METRICS, query) }
  if (pathname === '/api/nen-campaigns/metrics/columns') return { success: true, data: nenMetricsBody(NEN_COLUMN_METRICS, query) }
  if (pathname === '/api/nen-campaigns/metrics/pets') return { success: true, data: nenMetricsBody(NEN_PET_METRICS, query) }
  if (pathname === '/api/nen-campaigns/deliveries') {
    const status = query.get('status')
    const cursor = Math.max(0, Number.parseInt(query.get('cursor') ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.get('limit') ?? '20', 10) || 20))
    const filtered = status
      ? NEN_DELIVERIES.deliveries.filter((delivery) => delivery.status === status)
      : NEN_DELIVERIES.deliveries
    return {
      success: true,
      data: {
        ...nenMetricsBody(NEN_DELIVERIES, query),
        deliveries: filtered.slice(cursor, cursor + limit),
        pagination: {
          total: status ? filtered.length : NEN_DELIVERIES.pagination.total,
          limit,
          cursor: String(cursor),
          nextCursor: cursor + limit < (status ? filtered.length : NEN_DELIVERIES.pagination.total)
            ? String(cursor + limit)
            : null,
        },
      },
    }
  }
  const nenDeliveryDetail = /^\/api\/nen-campaigns\/deliveries\/([^/]+)$/.exec(pathname)
  if (nenDeliveryDetail) {
    const detail = NEN_DELIVERY_DETAILS[decodeURIComponent(nenDeliveryDetail[1])]
    return detail
      ? { success: true, data: detail }
      : { status: 404, body: { success: false, error: '配信記録が見つかりません' } }
  }
  if (pathname === '/api/nen-campaigns/birthday-coupon') return { success: true, data: NEN_BIRTHDAY_COUPON }
  if (pathname === '/api/nen-campaigns/overview') {
    // `jobs` が入っていないと `overview.jobs.pending` で落ちる。
    return { success: true, data: { activeCampaigns: 6, jobs: { total: 2640, pending: 148, sent: 2486, failed: 6 }, columns: 24, pets: 864, coupons: 28 } }
  }
  if (pathname === '/api/webhooks/interactions') {
    /*
      やり取りの記録。**`summary` が丸ごと要る。**
      既定の器だと `data.summary.total` で落ち、画面が
      「画面を表示できませんでした」になっていた。
      数は設計 `KNG00` に合わせる（この30日 1,972回・成功 1,966・失敗 6）。
    */
    return {
      success: true,
      data: {
        total: 1_972,
        page: 1,
        limit: 20,
        summary: { total: 1_972, outgoing: 1_486, incoming: 486, succeeded: 1_966, failed: 6, averageDurationMs: 400 },
        items: [
          {
            id: 'wi-1', direction: 'outgoing', webhookName: 'Slack ／ #注文チャンネル',
            eventType: '注文が確定したとき', triggerSummary: '注文 #12492・¥12,800・石田 未来',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 300, failureReason: null, canRetry: false,
            startedAt: '2026-08-25T02:42:00.000Z', completedAt: '2026-08-25T02:42:00.300Z', retryOfId: null,
          },
          {
            id: 'wi-2', direction: 'outgoing', webhookName: 'Slack ／ #アラート',
            eventType: '在庫が少なくなったとき', triggerSummary: '定期便パンフ 残り 3',
            status: 'failed', responseLabel: '503 Service Unavailable', responseStatus: 503,
            attemptCount: 3, durationMs: 10_000, failureReason: '相手が応答しませんでした', canRetry: true,
            startedAt: '2026-08-24T05:10:00.000Z', completedAt: '2026-08-24T05:10:10.000Z', retryOfId: null,
          },
          {
            id: 'wi-3', direction: 'incoming', webhookName: '予約サービス',
            eventType: '予約が入ったとき', triggerSummary: '8/26 14:00 トリミング（小型犬）',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 180, failureReason: null, canRetry: false,
            startedAt: '2026-08-24T01:05:00.000Z', completedAt: '2026-08-24T01:05:00.180Z', retryOfId: null,
          },
          {
            id: 'wi-4', direction: 'outgoing', webhookName: 'Google スプレッドシート ／ 注文一覧',
            eventType: '注文が確定したとき', triggerSummary: '注文 #12491・¥8,400・佐藤 陽子',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 520, failureReason: null, canRetry: false,
            startedAt: '2026-08-23T09:30:00.000Z', completedAt: '2026-08-23T09:30:00.520Z', retryOfId: null,
          },
          {
            id: 'wi-5', direction: 'outgoing', webhookName: 'kintone ／ 顧客管理',
            eventType: '友だちが追加されたとき', triggerSummary: '友だち U9a81…・流入 QRコード',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 260, failureReason: null, canRetry: false,
            startedAt: '2026-08-22T07:15:00.000Z', completedAt: '2026-08-22T07:15:00.260Z', retryOfId: null,
          },
          {
            id: 'wi-6', direction: 'incoming', webhookName: 'アンケートツール',
            eventType: 'アンケートに回答されたとき', triggerSummary: '回答 #A-1842・満足度 5',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 140, failureReason: null, canRetry: false,
            startedAt: '2026-08-21T03:20:00.000Z', completedAt: '2026-08-21T03:20:00.140Z', retryOfId: null,
          },
          {
            id: 'wi-7', direction: 'outgoing', webhookName: 'Chatwork ／ 発送連絡',
            eventType: '発送が完了したとき', triggerSummary: '注文 #12480・追跡 1234…',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 390, failureReason: null, canRetry: false,
            startedAt: '2026-08-20T11:05:00.000Z', completedAt: '2026-08-20T11:05:00.390Z', retryOfId: null,
          },
        ],
      },
    }
  }
  if (pathname === '/api/common-actions/resources') {
    /*
      共通アクションを作るときの選択肢。**器が6つとも要る。**

      `api.ts` の `CommonActionResources` は6つの配列を持つが、
      `readArrayGetPaths()` は「返りが配列そのもの」の口しか拾えないので、
      ここが既定の `{items,total,page,limit}` に落ちていた。
      画面は `resources.tags.map(...)` を読むので
      `Cannot read properties of undefined (reading 'map')` で
      `/common-actions/new` が「画面を表示できませんでした」になっていた。
    */
    return {
      success: true,
      data: {
        tags: [
          { id: 'tag-vip', name: 'VIP' },
          { id: 'tag-trial', name: '体験申込' },
        ],
        scenarios: [{ id: 'scenario-0', name: '来店後シナリオ' }],
        templates: [{ id: 'template-usage-1', name: '来店後のご案内' }],
        webhooks: [{ id: 'wh-1', name: '予約サービスへ知らせる' }],
        richMenus: [{ id: 'rmg-1', name: '通常メニュー' }],
        commonActions: [
          { id: 'ca-1', name: '来店後のご案内', version: 3 },
          { id: 'ca-subscription-guide', name: '定期便スタートガイド', version: 1 },
        ],
      },
    }
  }
  if (pathname.startsWith('/api/common-actions/') && !pathname.includes('/resources')) {
    // `versions` `bindings` が入っていないと `.find` で落ちる。
    return { success: true, data: COMMON_ACTION_DETAIL }
  }
  if (pathname === '/api/saved-searches' && query.get('format') === 'segment_v1') {
    /*
      配信の「保存した条件から選ぶ」。
      空だと「この条件を使う」の行が描かれず、設計 `sqFXf`（対象条件を編集）が
      撮れなかった。設計と同じ2件を返す。
    */
    return {
      success: true,
      data: [
        {
          id: 'sp-1', name: 'VIPかつ未契約', scope: 'friends', conditionFormat: 'segment_v1',
          conditions: { version: 1, condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-vip' }, { type: 'tag_not_exists', value: 'tag-trial' }], groups: [] } },
          createdBy: '河野 健太', lineAccountId: 'visual-qa-account', isShared: true,
          displayOrder: 1, createdAt: '2026-08-10T00:00:00.000Z',
          usedIn: [{ kind: 'broadcast', count: 2 }, { kind: 'automation', count: 1 }],
        },
        {
          id: 'sp-2', name: '誕生日30日前', scope: 'friends', conditionFormat: 'segment_v1',
          conditions: { version: 1, condition: { operator: 'AND', rules: [{ type: 'registered_at', value: { from: '2026-07-25', to: '' } }], groups: [] } },
          createdBy: '河野 健太', lineAccountId: 'visual-qa-account', isShared: false,
          displayOrder: 2, createdAt: '2026-08-18T00:00:00.000Z',
          usedIn: [{ kind: 'other', count: 1 }],
        },
      ],
    }
  }
  if (pathname === '/api/webinars') return { success: true, data: WEBINARS }
  if (pathname === '/api/webinars/overview') return { success: true, data: WEBINAR_OVERVIEW }
  if (/^\/api\/webinars\/[^/]+\/notifications$/.test(pathname)) return { success: true, data: WEBINAR_NOTIFICATIONS }
  if (/^\/api\/webinars\/[^/]+\/ctas$/.test(pathname)) return { success: true, data: WEBINAR_CTAS }
  if (/^\/api\/webinars\/[^/]+\/actions$/.test(pathname)) return { success: true, data: WEBINAR_ACTIONS }
  if (/^\/api\/webinars\/[^/]+\/user-comments$/.test(pathname)) return { success: true, data: [] }
  if (/^\/api\/webinars\/[^/]+\/analytics$/.test(pathname)) return { success: true, data: WEBINAR_ANALYTICS }
  if (/^\/api\/webinars\/[^/]+$/.test(pathname)) {
    /*
      ウェビナー1件。**器を通さない**（`fetchApi<{ data: Webinar }>`）。
      既定の器だと `analytics.participants.length` の手前で落ちて、
      `/webinars/edit` が丸ごと「画面を表示できませんでした」になっていた。
    */
    return {
      data: {
        ...WEBINARS[0], id: pathname.split('/').pop(),
      },
    }
  }
  if (pathname === '/api/friend-fields-stats') {
    /*
      友だち情報欄の帯。**口が無いと既定の器（`{items,total,page,limit}`）が返り、
      `summary.inUse` が `undefined` になって画面に「使用中 undefined件」と出ていた。**
      設計 `HBTk0` と文字を並べて初めて分かった。
      画面側も `undefined` を出さないよう直したが、正しい返事もここに置く。
    */
    return { success: true, data: { total: 12, inUse: 9, registeredFriends: 187, formLinks: 6, updatedThisMonth: 3 } }
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
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-CSRF-Token, X-Admin-Session, Idempotency-Key, X-Confirm-Irreversible',
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'ETag')

  if (method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  /*
    **いま動いているモックが、いまのファイルかを言う。**

    直したはずの返事が反映されず、しかもどこにも出ない、というのを
    何度かやった。直近では `/api/friend-fields-stats` を足したのに
    古いモックが動いたままで、画面に `undefined` が出続けた。
    さらに前には、口が足りない古いモックのせいで7画面が
    「画面を表示できませんでした」で落ち、実装の不具合に見えていた。

    ここが自分の中身の指紋を返し、`capture-screens.mjs` が
    ディスク上のファイルと突き合わせて、違えば撮影に入る前に止まる。
  */
  if (url.pathname === '/__mock-fingerprint') {
    res.writeHead(200).end(JSON.stringify({ fingerprint: FINGERPRINT }))
    return
  }

  if (method === 'GET' && url.pathname === '/api/conversions/export') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="conversion-definitions-2026-08-25.csv"')
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(200).end(CONVERSION_EXPORT_CSV)
    return
  }

  if (method === 'GET' && url.pathname === '/api/nen-members/photos/original-download/visual-qa-once') {
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'base64')
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(200).end(jpeg)
    return
  }

  if (method === 'GET' && url.pathname.startsWith('/api/rich-menu-images/')) {
    // 6面が見分けられる撮影専用画像。1px画像ではキャンバスが黒く見え、
    // 画像本体を取得できたか判定できないため、実際の比率に近いPNGを返す。
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAKXklEQVR42u3WMRGAMBAAwYhAASJQgQYkMPjABJLoqejSkaGgDQbyCrLFarhLwzpXoG3cFyAwHRsQSCIKBgsMFhgsMFhgsMBggcECgwUGCzBYYLDAYIHBAoMFBgsMFhgsMFhgsACDBQYLDBYYLDBYYLDAYIHBAoMFBgswWGCwwGCBwQKDBQYLDBYYLDBYYLAAgwUGCwwWGCwwWGCwwGCBwQKDBQYLMFhgsMBggcECgwUGCwwWGCwwWIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQJEFAwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgAQYLDBYYLDBYYLDAYIHBAoMFBgsQUTBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLCEFgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCwwWIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYAEGCwwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgiSgYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCwRBYMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDJaJgsMBggcECgwUGCwwWGCwwWGCwAIMFBgsMFhgsMFhgsMBggcECgwXdDdbzvRVou0sGAme+gIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQJEFAwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgAQYLDBYYLDBYYLDAYIHBAoMFBgsQUTBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLCEFgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCwwWIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYAEGCwwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgiSgYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCwRBYMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDJaJgsMBggcECgwUGCwwWGCwwWGCwAIMFBgsMFhgsMFhgsMBggcECgwUGCzBYYLDAYIHBAoMFBgsMFhgsMFhgsACDBQYLDBYYLDBYYLDAYIHBAoMFBgswWGCwwGCBwQKDBQYLDBYYLDBYYLBEFAwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgAQYLDBYYLDBYYLDAYIHBAoMFBgsMloiCwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcESUTBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBgu780r18zIsQvWAAAAAASUVORK5CYII=', 'base64')
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(200).end(png)
    return
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  // 更新は原則通さない。固定結果を返す3口も保存・配信は一切行わない。
  // それ以外を通すと「保存できたつもり」の画像が撮れてしまい、
  // 動いていない画面を動いていると読み違える。
  //
  // ただし画面側のエラー報告だけは 204 で受ける。405 を返すと、
  // 報告が失敗したこと自体が新しいエラーになって際限なく増える。
  if (method !== 'GET') {
    if (method === 'POST' && /^\/api\/automation-runs\/[^/]+\/retry$/.test(url.pathname)) {
      res.writeHead(202).end(JSON.stringify({
        success: true,
        data: { runId: url.pathname.split('/')[3], retryStepCount: 1, status: 'succeeded' },
      }))
      return
    }
    if (method === 'POST' && /^\/api\/automation-templates\/[^/]+\/drafts$/.test(url.pathname)) {
      res.writeHead(201).end(JSON.stringify({
        success: true,
        data: { id: 'automation-visual-draft', draftVersionId: 'automation-visual-version' },
      }))
      return
    }
    if (method === 'PUT' && url.pathname === '/api/automation-drafts/automation-visual-draft') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { updated: true } }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/automations/automation-visual-draft/audience-preview') {
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: {
          automationId: 'automation-visual-draft',
          versionId: 'automation-visual-version',
          matched: 286,
          total: 842,
          freshness: 'available',
          calculatedAt: '2026-09-07T03:00:00.000Z',
        },
      }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/automations/automation-visual-draft/test') {
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: { runId: 'automation-visual-test', versionId: 'automation-visual-version', status: 'succeeded' },
      }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/automation-drafts/automation-visual-draft/publish') {
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: { id: 'automation-visual-draft', versionId: 'automation-visual-version', versionNumber: 1, status: 'active' },
      }))
      return
    }
    if (method === 'PATCH' && /^\/api\/mileage\/earning-rules\/[^/]+\/draft$/.test(url.pathname)) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const ruleId = url.pathname.split('/')[4]
        const version = Number.isInteger(body.expectedVersion) ? body.expectedVersion + 1 : 1
        res.writeHead(200).end(JSON.stringify({
          success: true,
          data: {
            ruleId,
            lineAccountId: body.accountId ?? 'visual-qa-account',
            version,
            draft: body.draft ?? {},
            updatedAt: '2026-09-07T03:31:00.000Z',
          },
        }))
      })
      return
    }
    if (method === 'POST' && url.pathname === '/api/media/upload-sessions') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const files = Array.isArray(body.files) ? body.files : []
        const sessions = files.map((file, index) => ({
          id: `visual-upload-${index + 1}`,
          filename: String(file.filename ?? `upload-${index + 1}`),
          sizeBytes: Number(file.sizeBytes ?? 1),
          targetMediaId: file.targetMediaId ?? null,
          method: 'PUT',
          uploadUrl: `http://${HOST}:${PORT}/api/media/upload-sessions/visual-upload-${index + 1}/blob`,
          requiredHeaders: { 'Content-Type': String(file.mimeType ?? 'application/octet-stream') },
          expiresAt: '2026-09-07T15:15:00.000Z',
        }))
        res.writeHead(201).end(JSON.stringify({ success: true, data: { sessions } }))
      })
      return
    }
    if (method === 'PUT' && /^\/api\/media\/upload-sessions\/[^/]+\/blob$/.test(url.pathname)) {
      res.setHeader('ETag', '"visual-qa-etag"')
      res.writeHead(200).end()
      return
    }
    if (method === 'POST' && /^\/api\/media\/upload-sessions\/[^/]+\/complete$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { uploadSessionId: url.pathname.split('/')[4], status: 'completed', mediaId: 'media-uploaded-1', targetMediaId: null } }))
      return
    }
    if (url.pathname === '/api/client-errors') {
      res.writeHead(204).end()
      return
    }
    // `ymXJK` の下書き保存だけは、契約どおりの固定201を返す。
    // DB更新はせず、ほかのPOSTは従来どおり405にする。
    if (method === 'POST' && url.pathname === '/api/nen-campaigns/columns') {
      res.writeHead(NEN_COLUMN_CREATE.success.status).end(JSON.stringify(NEN_COLUMN_CREATE.success.body))
      return
    }
    const nenDuplicate = /^\/api\/nen-campaigns\/columns\/[^/]+\/duplicate$/.test(url.pathname)
    if (method === 'POST' && nenDuplicate) {
      res.writeHead(201).end(JSON.stringify({ success: true, data: NEN_COLUMN_OPERATIONS.duplicate }))
      return
    }
    const nenTestSend = /^\/api\/nen-campaigns\/columns\/[^/]+\/test-send$/.test(url.pathname)
    if (method === 'POST' && nenTestSend) {
      res.writeHead(200).end(JSON.stringify({ success: true }))
      return
    }
    const nenReadEvent = /^\/api\/nen-campaigns\/columns\/[^/]+\/read-events$/.test(url.pathname)
    if (method === 'POST' && nenReadEvent) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: NEN_COLUMN_OPERATIONS.readEvent }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/nen-campaigns/deliveries/pending-now') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: NEN_COLUMN_OPERATIONS.pendingNow }))
      return
    }
    /*
      タグCSVの下見と結果。保存はせず、受け取った行を固定規則で判定する。
      空欄・長すぎる名前・制御文字・既存名・不明フォルダを同じ入力なら
      毎回同じ結果にし、成功と一部失敗の両方を撮れるようにする。
    */
    if (method === 'POST' && (url.pathname === '/api/tags/import/preview' || url.pathname === '/api/tags/import')) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let rows = TAG_IMPORT_SAMPLE_ROWS
        try {
          const parsed = JSON.parse(raw || '{}')
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) rows = parsed.rows
        } catch {
          rows = TAG_IMPORT_SAMPLE_ROWS
        }
        const data = url.pathname.endsWith('/preview') ? tagImportPreview(rows) : tagImportResult(rows)
        res.writeHead(200).end(JSON.stringify({ success: true, data }))
      })
      return
    }
    /*
      共通情報を**変える前**の確認（`uNBlA`）。**POST だが保存はしない。**
      長い本文を投げるために `POST` なので、ここで 405 を返すと
      「口はあるのに画面が壊れている」ように見える絵が撮れてしまう。
    */
    if (method === 'POST' && /^\/api\/common-vars\/[^/]+\/impact-preview$/.test(url.pathname)) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let nextValue = ''
        try { nextValue = JSON.parse(raw || '{}').nextValue ?? '' } catch { nextValue = '' }
        res.writeHead(200).end(JSON.stringify({
          success: true,
          data: commonVarChangeImpact(typeof nextValue === 'string' ? nextValue : ''),
        }))
      })
      return
    }
    /*
      共通情報の差し替え（PR #1131）。候補取得・影響確認・実行完了を
      同じPOSTの入力で分けるが、モックは保存せず固定結果だけ返す。
    */
    if (method === 'POST' && url.pathname === `/api/common-vars/${COMMON_VAR_DETAIL.id}/replace`) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const data = !body.replacementId
          ? COMMON_VAR_REPLACEMENT_CANDIDATES
          : body.apply === true
            ? COMMON_VAR_REPLACEMENT_RESULT
            : COMMON_VAR_REPLACEMENT_PREVIEW
        res.writeHead(200).end(JSON.stringify({ success: true, data }))
      })
      return
    }
    /*
      代理予約の登録完了と予約枠競合。**POSTだが保存も通知も起こさない。**
      撮影手順の10:00だけ成功、14:00だけ競合にし、ほかの時刻を誤って
      登録済みに見せない。本番と同じく成功は201、競合は409で返す。
    */
    if (method === 'POST' && url.pathname === '/api/booking/admin/bookings') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let startsAt = ''
        try {
          const parsed = JSON.parse(raw || '{}')
          startsAt = typeof parsed.starts_at === 'string' ? parsed.starts_at : ''
        } catch {
          startsAt = ''
        }
        const fixed = startsAt === '2026-09-03T01:00:00.000Z'
          ? BOOKING_PROXY_CREATE.success
          : startsAt === '2026-09-03T05:00:00.000Z'
            ? BOOKING_PROXY_CREATE.conflict
            : BOOKING_PROXY_CREATE.unavailable
        res.writeHead(fixed.status).end(JSON.stringify(fixed.body))
      })
      return
    }
    /*
      成果の締め・振込データ・明細（機能16）。本番と同じHTTP状態と器を返すが、
      DB更新、ファイル生成、紹介者への通知は一切行わない。
    */
    if (method === 'POST' && url.pathname === '/api/affiliate-settlements') {
      res.writeHead(201).end(JSON.stringify({ success: true, data: AFFILIATE_SETTLEMENT_CREATED }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/affiliate-payout-batches') {
      res.writeHead(201).end(JSON.stringify({ success: true, data: AFFILIATE_PAYOUT_BATCH }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/affiliate-statements') {
      res.writeHead(201).end(JSON.stringify({
        success: true, data: AFFILIATE_STATEMENT, notificationAttempted: true,
      }))
      return
    }
    /*
      写真審査の一括判断と派生画像処理。撮影用に本番と同じ受付結果を返すだけで、
      審査・ポイント付与・画像生成・通知は一切実行しない。
    */
    if (method === 'POST' && url.pathname === '/api/nen-members/photos/decisions/bulk') {
      res.writeHead(201).end(JSON.stringify({
        success: true, duplicate: false, data: NEN_PHOTO_BULK_DECISION_RESULT,
      }))
      return
    }
    /*
      機能22の原本保存。実物や秘密値は返さず、再認証と一回限りURLの
      画面遷移だけを固定応答で確認する。000000 は失敗確認専用。
    */
    if (method === 'POST' && url.pathname === '/api/auth/step-up') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        if (body.purpose !== 'photo.original.download' || body.code === '000000') {
          res.writeHead(400).end(JSON.stringify({ success: false, error: '再認証コードを確認してください。' }))
          return
        }
        res.writeHead(201).end(JSON.stringify({
          success: true,
          data: {
            token: 'visual-qa-photo-original-step-up',
            purpose: 'photo.original.download',
            expiresAt: '2026-09-07T03:10:00.000Z',
          },
        }))
      })
      return
    }
    const photoOriginalIssue = /^\/api\/nen-members\/photos\/([^/]+)\/original-download$/.exec(url.pathname)
    if (method === 'POST' && photoOriginalIssue) {
      if (req.headers['x-step-up-token'] !== 'visual-qa-photo-original-step-up') {
        res.writeHead(428).end(JSON.stringify({ success: false, error: '原本の保存には再認証が必要です。' }))
        return
      }
      res.writeHead(201).end(JSON.stringify({
        success: true,
        data: {
          downloadUrl: '/api/nen-members/photos/original-download/visual-qa-once',
          expiresAt: '2026-09-07T03:05:00.000Z',
          oneTime: true,
        },
      }))
      return
    }
    const photoAssetProcess = /^\/api\/nen-members\/photos\/([^/]+)\/assets\/process$/.exec(url.pathname)
    if (method === 'POST' && photoAssetProcess) {
      res.writeHead(202).end(JSON.stringify({
        success: true,
        duplicate: false,
        data: { ...NEN_PHOTO_ASSET_PROCESS_RESULT, photoId: photoAssetProcess[1] },
      }))
      return
    }
    // 機能3の保存した検索。DBへは書かず、本番契約と同じ201と保存済みの器を返す。
    if (method === 'POST' && url.pathname === '/api/friends/saved-views') {
      res.writeHead(201).end(JSON.stringify({ success: true, data: FRIEND_SAVED_VIEWS.items[0] }))
      return
    }
    const fixedResult = visualQaWriteBody(method, url.pathname)
    if (fixedResult) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: fixedResult }))
      return
    }
    // 対象確認は書き込みを起こさない。IAf7j の確認窓を通常データで撮るため、
    // この1本だけ本物と同じPOSTの器で返す。実行・再試行・取り消しは405のまま。
    if (method === 'POST' && url.pathname === '/api/friends/bulk-runs/preview') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: FRIEND_BULK_RUN.preview }))
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
  const rawPattern = RAW_PATTERNS.find(([re]) => re.test(url.pathname))
  if (rawPattern) {
    const fixed = typeof rawPattern[1] === 'function' ? rawPattern[1](url) : rawPattern[1]
    res.writeHead(200).end(JSON.stringify(fixed))
    return
  }
  res.writeHead(200).end(JSON.stringify(bodyFor(url.pathname, url.searchParams)))
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
  console.log(`[visual-qa] mock API on http://${HOST}:${PORT}（固定の画面確認結果以外の更新は405）`)
})
