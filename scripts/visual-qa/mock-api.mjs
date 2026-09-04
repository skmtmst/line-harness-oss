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
  FORM_DELETE_IMPACT_FIXTURES,
  COMMON_VARS,
  COMMON_VAR_DELETE_IMPACT,
  commonVarChangeImpact,
  COMMON_VAR_DELETE_IMPACT_EMPTY,
  MEDIA_DELETE_IMPACT,
  MEDIA_DELETE_IMPACT_EMPTY,
  MEDIA_REPLACEMENT_IMPACT,
  MEDIA_REPLACEMENT_IMPACT_BLOCKED,
  MEDIA_REPLACEMENT_IMPACT_EMPTY,
  MEDIA_ITEMS,
  FRIEND_ADD_LIFECYCLE_DRAFT,
  FRIEND_ADD_LIFECYCLE_PUBLISHED,
  FRIEND_ADD_LIFECYCLE_TEST_RESULT,
  FRIEND_ADD_LIFECYCLE_VALIDATION,
  AUTO_REPLIES, AUTO_REPLY_FOLDERS,
  BROADCASTS, CHATS, FRIEND_FIELDS, INBOX_STATS, INBOX_SAVED_VIEWS, FRIEND_MESSAGES, FRIEND_MILEAGE, FRIEND_DETAILS,
  TEMPLATES, TEMPLATE_FOLDERS,
  DUPLICATE_STATS, FRIENDS, FRIEND_BULK_RUN, FRIEND_SCENARIOS, FRIEND_STATS,
  IDENTITY_CANDIDATE_DETECTION, IDENTITY_CANDIDATE_EC, IDENTITY_CANDIDATE_ERROR, IDENTITY_CANDIDATE_FRIEND,
  IDENTITY_CANDIDATE_LISTS,
  MERGED_PERSON_DETAIL, MERGED_PERSON_EMPTY, MERGED_PERSON_ERROR,
  LIST_STATS, NEN_COLUMN_CREATE, OPERATORS, REMINDERS, REMINDER_FOLDERS, SCENARIO_STATS, SCENARIO_STEPS, USERS_GROUPED,
  RICH_MENU_DELETE_IMPACT, RICH_MENU_DELETE_IMPACT_EMPTY,
  TAGS, TAG_GROUPS,
  SUPPORT_MARKS, SUPPORT_MARK_AUTOMATION_RULES,
  OUTGOING_WEBHOOKS, INCOMING_WEBHOOKS, ENTRY_ROUTES, STAFF_MEMBERS, LOGIN_AUDIT,
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
/** 分析の指標1つ。`state` と `reason` を持つのが契約。 */
const METRIC = (value, state = 'available', reason = null) => ({ value, state, reason })

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
  '/api/conversions/approvals': [
    {
      eventId: 'cv-1', createdAt: '2026-08-24T20:53:00+09:00',
      friendId: 'friend-1', friendName: 'さかもとまさと',
      affiliateId: 'af-1', affiliateName: 'Masato.S',
      offerId: 'of-1', offerName: '夏の紹介キャンペーン', offerRewardMiles: 50,
      conversionPointName: '購入完了', value: 12000,
      approvalStatus: 'pending', duplicateFlag: false,
    },
    {
      eventId: 'cv-2', createdAt: '2026-08-19T09:12:00+09:00',
      friendId: 'friend-2', friendName: 'Kyohei Yamamoto',
      affiliateId: 'af-1', affiliateName: 'Masato.S',
      offerId: null, offerName: null, offerRewardMiles: null,
      conversionPointName: '資料請求', value: null,
      approvalStatus: 'approved', duplicateFlag: false,
    },
    {
      eventId: 'cv-3', createdAt: '2026-08-13T20:52:00+09:00',
      friendId: 'friend-3', friendName: null,
      affiliateId: 'af-2', affiliateName: null,
      offerId: 'of-1', offerName: '夏の紹介キャンペーン', offerRewardMiles: 50,
      conversionPointName: '購入完了', value: 8000,
      approvalStatus: 'pending', duplicateFlag: true,
    },
  ],
  '/api/action-scores/friends': {
    summary: {
      scoredFriends: 5, high: 1, normal: 3, low: 1, decreased30d: 0,
      highMin: 70, normalMin: 40,
    },
    items: [
      { friendId: 'friend-1', displayName: 'さかもとまさと', score: 82, band: 'high', change30d: 4, lastActionAt: '2026-08-24T20:53:00+09:00' },
      { friendId: 'friend-2', displayName: 'Kyohei Yamamoto', score: 55, band: 'normal', change30d: 0, lastActionAt: '2026-08-19T09:12:00+09:00' },
      { friendId: 'friend-3', displayName: '菅野 亮', score: 31, band: 'low', change30d: -6, lastActionAt: '2026-08-13T20:52:00+09:00' },
    ],
    pagination: { total: 3, limit: 20, offset: 0 },
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
        { key: 'tags', label: 'タグ', href: '/tags', created: METRIC(101), inUse: METRIC(22), unused: METRIC(79), brokenReferences: METRIC(0), lastUsedAt: METRIC('2026-08-24') },
        { key: 'templates', label: 'テンプレート', href: '/templates', created: METRIC(0), inUse: METRIC(0), unused: METRIC(0), brokenReferences: METRIC(0), lastUsedAt: METRIC(null, 'unavailable', 'まだ使われていません') },
        { key: 'scenarios', label: 'シナリオ', href: '/scenarios', created: METRIC(11), inUse: METRIC(11), unused: METRIC(0), brokenReferences: METRIC(0), lastUsedAt: METRIC('2026-08-26') },
      ],
    },
  },
  '/api/mileage/history': {
    items: [
      {
        id: 'ml-1', friendId: 'friend-1', friendName: 'さかもとまさと',
        entryType: 'earn', status: 'confirmed', mode: 'automatic',
        amount: 5, balanceAfter: 5, reason: '写真の投稿が通りました',
        occurredAt: '2026-08-24T20:53:00+09:00', createdAt: '2026-08-24T20:53:00+09:00',
      },
      {
        id: 'ml-2', friendId: 'friend-2', friendName: 'Kyohei Yamamoto',
        entryType: 'earn', status: 'confirmed', mode: 'automatic',
        amount: 3, balanceAfter: 3, reason: '友だち追加',
        occurredAt: '2026-08-19T09:12:00+09:00', createdAt: '2026-08-19T09:12:00+09:00',
      },
      {
        id: 'ml-3', friendId: 'friend-3', friendName: '菅野 亮',
        entryType: 'spend', status: 'confirmed', mode: 'manual',
        amount: -2, balanceAfter: 1, reason: '手で減らしました',
        occurredAt: '2026-08-13T20:52:00+09:00', createdAt: '2026-08-13T20:52:00+09:00',
      },
    ],
    pagination: { total: 3, limit: 20, offset: 0 },
  },
  '/api/settings/features': {
    features: FEATURES,
    sidebarOrder: null,
    sidebarItemOrder: null,
    parentChildMode: false,
    specializedFeatureKeys: [],
  },
  '/api/inbox/unanswered/count': { total: 0, byAccount: [], oldestWaitMinutes: null },
  // 設計 `vUXKb` の「写真審査 1件 確認待ち」。0で返すとカードが空のまま撮れる。
  '/api/nen-members/overview': { pets: 0, healthLogs: 0, activeCare: 0, pendingPhotos: 1, members: 0, consultations: 0 },
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

  /* 友だち追加時配信の公開前確認（PR #597）。契約と同じ形を返す。 */
  '/api/friend-add-routing/draft': FRIEND_ADD_LIFECYCLE_DRAFT,
  '/api/friend-add-routing/conflicts': { conflicts: [] },

}

/**
 * 画面確認だけで完結する、保存を伴わない固定の返事。
 * 本番データは変更せず、毎回同じ結果を返す。ほかの更新は従来どおり405。
 */
function visualQaWriteBody(method, pathname) {
  if (method === 'POST' && pathname === '/api/friend-add-routing/validate') {
    return FRIEND_ADD_LIFECYCLE_VALIDATION
  }
  if (method === 'POST' && pathname === '/api/friend-add-routing/draft/test') {
    return FRIEND_ADD_LIFECYCLE_TEST_RESULT
  }
  if (method === 'POST' && pathname === '/api/friend-add-routing/publish') {
    return FRIEND_ADD_LIFECYCLE_PUBLISHED
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
  '/api/booking/admin/menus': { menus: [] },
  '/api/booking/admin/staff': { staff: [] },
  '/api/events/admin/events': { items: [] },
  // 予約メニューの帯は `requests` から件数を出す。包むと `.filter` で落ちる。
  '/api/booking/admin/requests': { requests: [] },
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
  [/^\/api\/events\/admin\/events\/[^/]+\/bookings$/, { items: [] }],
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

function bodyFor(pathname, query = new URLSearchParams()) {
  if (pathname === '/api/auth/session') {
    return { success: true, data: STAFF, csrfToken: 'visual-qa-csrf' }
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
        ...ACCOUNT,
        webhook: { status: 'matched', expectedUrl: `${'https://api.example'}/webhook`, actualUrl: `${'https://api.example'}/webhook`, active: true, checkedAt: `${FIXED_TO}T00:00:00.000Z` },
        channelAccessTokenConfigured: true,
        channelSecretConfigured: true,
        loginChannelSecretConfigured: true,
        friendCapacity: 50000,
        capacityWarnAt: 45000,
        country: '日本',
        role: '検証用。本番の配信には使わない',
      },
    }
  }
  if (pathname === '/api/line-accounts') {
    /*
      `webhook` を付ける。無いと接続状態カードが「確認中」のままで、
      設計の「正常」と並べたときに実装の差に見えてしまう。
    */
    return { success: true, data: [{ ...ACCOUNT, webhook: { status: 'matched', checkedAt: `${FIXED_TO}T00:00:00.000Z` } }] }
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
  if (pathname === '/api/folders' && query.get('kind') === 'template') {
    return { success: true, data: TEMPLATE_FOLDERS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'reminder') {
    return { success: true, data: REMINDER_FOLDERS }
  }
  if (pathname === '/api/friend-fields') return { success: true, data: FRIEND_FIELDS }
  if (pathname === '/api/folders' && query.get('kind') === 'auto_reply') {
    return { success: true, data: AUTO_REPLY_FOLDERS }
  }
  if (pathname === '/api/auto-replies') return { success: true, data: AUTO_REPLIES }
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
  if (/^\/api\/scenarios\/[^/]+\/stats$/.test(pathname)) return { success: true, data: SCENARIO_STATS }
  const scenario = pathname.match(/^\/api\/scenarios\/([^/]+)$/)
  if (scenario) {
    // 通を配列で返す。`{items,total}` のままだと `scenario.steps` で落ちる。
    const row = FRIEND_SCENARIOS.find((r) => r.id === scenario[1]) ?? FRIEND_SCENARIOS[0]
    return { success: true, data: { ...row, steps: SCENARIO_STEPS.map((step) => ({ ...step, scenarioId: row.id })) } }
  }
  if (pathname === '/api/broadcasts') return { success: true, data: BROADCASTS }
  if (pathname === '/api/inbox/saved-views') return { success: true, data: INBOX_SAVED_VIEWS }
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
  if (pathname === '/api/tags') return { success: true, data: TAGS }
  if (pathname === '/api/support-marks') return { success: true, data: SUPPORT_MARKS }
  /* 自動変更ルール（設計 `GMvBd` 4-3-A）。マークごとに返す。 */
  if (/^\/api\/support-marks\/[^/]+\/automation-rules$/.test(pathname)) {
    return { success: true, data: SUPPORT_MARK_AUTOMATION_RULES }
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
  if (pathname === '/api/webhooks/incoming') return { success: true, data: INCOMING_WEBHOOKS }
  if (pathname === '/api/entry-routes') return { success: true, data: ENTRY_ROUTES }
  if (pathname === '/api/staff') return { success: true, data: STAFF_MEMBERS }
  if (pathname === '/api/login-audit') return { success: true, data: LOGIN_AUDIT }
  if (pathname === '/api/common-vars') return { success: true, data: COMMON_VARS }
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
  if (pathname === '/api/support-marks') {
    /*
      対応マーク。**「保留」と「対応中」が要る。**
      設計 `GMvBd`（追加・編集）と `zGZMA`（削除の確認）は、この2つの行を
      押してから開く。行が無いと押しどころが無く、6+1 状態が撮れなかった。

      `usedIn` も持たせる。**参照数が無いと「削除できるか確認できません」**
      になり、削除の確認窓（`zGZMA`）まで進めない。「対応中」は使用先を
      持たせて**消せない側**、「保留」は 0 で**消せる側**にして、
      両方の見た目を撮れるようにする。
    */
    const mark = (id, name, color, order, extra = {}) => ({
      id, name, color, isDefault: order === 0, autoOnInbound: order === 0,
      displayOrder: order, createdAt: `${FIXED_TO}T00:00:00.000Z`,
      friendCount: 0,
      usedIn: { broadcasts: 0, scenarios: 0, autoReplies: 0, savedSearches: 0, automations: 0 },
      ...extra,
    })
    return {
      success: true,
      data: [
        mark('sm-1', '未対応', '#e5484d', 0, { friendCount: 23 }),
        mark('sm-2', '対応中', '#f5c56b', 1, {
          friendCount: 8,
          usedIn: { broadcasts: 1, scenarios: 0, autoReplies: 2, savedSearches: 0, automations: 0 },
        }),
        mark('sm-3', '保留', '#8b8f94', 2, { friendCount: 4 }),
        mark('sm-4', '対応済み', '#05913e', 3, { friendCount: 186 }),
      ],
    }
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
  if (pathname === '/api/nen-campaigns/overview') {
    // `jobs` が入っていないと `overview.jobs.pending` で落ちる。
    return { success: true, data: { activeCampaigns: 2, jobs: { total: 18, pending: 3, sent: 14, failed: 1 }, columns: 6, pets: 4, coupons: 2 } }
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
        commonActions: [{ id: 'ca-1', name: '来店後のご案内', version: 3 }],
      },
    }
  }
  if (pathname.startsWith('/api/common-actions/') && !pathname.includes('/resources')) {
    // `versions` `bindings` が入っていないと `.find` で落ちる。
    return { success: true, data: { id: pathname.split('/').pop(), name: '来店後のご案内', versions: [], bindings: [], currentPublishedVersionId: null, currentDraftVersionId: null } }
  }
  if (pathname === '/api/saved-searches' && query.get('format') === 'segment_v1') {
    /*
      配信の「保存した条件から選ぶ」。
      空だと「この条件を使う」の行が描かれず、設計 `sqFXf`（対象条件を編集）が
      撮れなかった。設計と同じ2件を返す。
    */
    const rule = (field, op, value) => ({ field, operator: op, value })
    return {
      success: true,
      data: [
        {
          id: 'sp-1', name: 'VIPかつ未契約', scope: 'friends', conditionFormat: 'segment_v1',
          conditions: { version: 1, condition: { operator: 'AND', rules: [rule('tag', 'includes', 'VIP'), rule('tag', 'excludes', '契約中')] } },
          createdBy: '河野 健太', lineAccountId: 'visual-qa-account', isShared: true,
          displayOrder: 1, createdAt: '2026-08-10T00:00:00.000Z',
          usedIn: [{ kind: 'broadcast', count: 2 }, { kind: 'automation', count: 1 }],
        },
        {
          id: 'sp-2', name: '誕生日30日前', scope: 'friends', conditionFormat: 'segment_v1',
          conditions: { version: 1, condition: { operator: 'AND', rules: [rule('field', 'within_days', 30)] } },
          createdBy: '河野 健太', lineAccountId: 'visual-qa-account', isShared: false,
          displayOrder: 2, createdAt: '2026-08-18T00:00:00.000Z',
          usedIn: [{ kind: 'other', count: 1 }],
        },
      ],
    }
  }
  if (/^\/api\/webinars\/[^/]+$/.test(pathname)) {
    /*
      ウェビナー1件。**器を通さない**（`fetchApi<{ data: Webinar }>`）。
      既定の器だと `analytics.participants.length` の手前で落ちて、
      `/webinars/edit` が丸ごと「画面を表示できませんでした」になっていた。
    */
    return {
      data: {
        id: pathname.split('/').pop(), accountId: 'visual-qa-account',
        title: '定期便のはじめ方', slug: 'subscription-start', status: 'active',
        videoPrefix: 'nen/subscription-start', durationSeconds: 2_580,
        schedule: [], cta: { label: '詳しく見る', url: 'https://example.com/subscription', showAtSeconds: 900 },
        tagOnAttend: null, tagOnCtaClick: null,
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-25T02:00:00.000Z',
      },
    }
  }
  if (/^\/api\/webinars\/[^/]+\/analytics$/.test(pathname)) {
    // 一覧の器だと `participants` `daily` `formFunnel` が無く、画面が落ちる。
    return {
      data: {
        summary: {
          reservations: 128, viewers: 96, registeredAndJoined: 74, watched5m: 88,
          watched15m: 61, completed: 34, avgWatchedSeconds: 1_140, ctaClicks: 41, formSubmissions: 18,
        },
        daily: [], participants: [], sessions: [], dropoff: [],
        formFunnel: {
          ctaImpressions: 96, ctaClicks: 41, formOpens: 33, formStarts: 27,
          submitAttempts: 21, submitSuccesses: 18, submitErrors: 3, fieldCompletions: [],
        },
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
    return { success: true, data: { total: 12, inUse: 9, registeredFriends: 1_284, formLinks: 3, updatedThisMonth: 4 } }
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

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

  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  // 更新は原則通さない。固定結果を返す3口も保存・配信は一切行わない。
  // それ以外を通すと「保存できたつもり」の画像が撮れてしまい、
  // 動いていない画面を動いていると読み違える。
  //
  // ただし画面側のエラー報告だけは 204 で受ける。405 を返すと、
  // 報告が失敗したこと自体が新しいエラーになって際限なく増える。
  if (method !== 'GET') {
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
    res.writeHead(200).end(JSON.stringify(rawPattern[1]))
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
