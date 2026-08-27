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
 * - **更新は必ず失敗させる。** GET と OPTIONS 以外は 405。保存も配信も起きない
 * - 実データ・秘密値を持たない。名前も固定の作り物
 * - 毎回まったく同じものを返す。乱数も時刻も使わない（画像が毎回同じになる）
 *
 * 使い方
 *   node scripts/visual-qa/mock-api.mjs            # 既定 8788番
 *   PORT=9000 node scripts/visual-qa/mock-api.mjs
 */
import { createServer } from 'node:http'
import { readArrayGetPaths } from './api-shapes.mjs'
import { FRIENDS, FRIEND_SCENARIOS, FRIEND_STATS, LIST_STATS, OPERATORS, TAGS, TAG_GROUPS } from './fixtures.mjs'

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
const DASHBOARD_OVERVIEW = {
  period: 'last7',
  generatedAt: `${FIXED_TO}T00:00:00.000Z`,
  friends: { active: 0, total: 0, blockedByThem: 0, hiddenByUs: 0, blockedBoth: 0 },
  inbox: { unanswered: 0, inProgress: 0, resolved: 0, oldestUnansweredMinutes: null, averageFirstReplyMinutes: null },
  delivery: { sent: 0, push: 0, reply: 0, broadcasts: 0, quotaLimit: null, quotaUsed: null },
  trend: [],
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
    specializedFeatureKeys: [],
  },
  '/api/inbox/unanswered/count': { total: 0, byAccount: [], oldestWaitMinutes: null },
  '/api/nen-members/overview': { pets: 0, healthLogs: 0, activeCare: 0, pendingPhotos: 0, members: 0, consultations: 0 },
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

function bodyFor(pathname) {
  if (pathname === '/api/auth/session') {
    return { success: true, data: STAFF, csrfToken: 'visual-qa-csrf' }
  }
  if (pathname === '/api/line-accounts') {
    return { success: true, data: [ACCOUNT] }
  }
  // 設計と画像で比べるための中身。空の表しか描けないと、
  // 「空の状態」だけを見て一致したと言えてしまう。
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
  if (pathname === '/api/tag-groups') return { success: true, data: TAG_GROUPS }
  if (pathname === '/api/list-stats') return { success: true, data: LIST_STATS }
  if (/^\/api\/accounts\/[^/]+\/health$/.test(pathname)) {
    // `{status,checks}` ではない。ダッシュボードは `logs` を数える。
    return { success: true, data: { riskLevel: 'ok', logs: [] } }
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Admin-Session')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

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
  if (method !== 'GET') {
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
  res.writeHead(200).end(JSON.stringify(bodyFor(url.pathname)))
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
