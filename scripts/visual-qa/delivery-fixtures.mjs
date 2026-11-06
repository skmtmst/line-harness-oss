/*
 * デリバリー受注（板 kDQHr・OzHLO・h7OeT／窓 hjdqV・dgeTy・XCVGd）の
 * 設計測定だけで使う仮のこたえ。
 *
 * 絵（`v8-design-refs/*.html`）に出ている文字をそのまま入れている。
 * 文字の内容は `docs/v8-design-rules.md` が「合格にしてよい違い」に数えるが、
 * 中身が空だと行が出ず、位置を比べられない。だから絵と同じ件数・同じ並びにする。
 *
 * ここは測定専用。`scripts/visual-qa/mock-api.mjs`（CIの共通の仮サーバー）には触れない。
 */

/** 絵の「最終 12:08」に合わせた時刻（日本時間 12:08）。 */
export const DELIVERY_CLOCK = '2026-10-09T03:08:00.000Z'

const CLOCK_MS = new Date(DELIVERY_CLOCK).getTime()

/** 受信からの経過（分）を受け取り、絵と同じ「経過」になる受信時刻を返す。 */
const receivedAgo = (minutes) => new Date(CLOCK_MS - minutes * 60000).toISOString()

/** 日本時間の時刻（「12:02」）を ISO に直す。絵の日付は 2026/10/09。 */
const jst = (hhmm) => {
  const [hh, mm] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 9, 9, hh - 9, mm, 0)).toISOString()
}

export const STORE = { id: 'store-nen-1', name: '然-NEN- 本店' }

export const SERVICES = [
  {
    service: 'ubereats',
    label: 'Uber Eats',
    connectionStatus: 'connected',
    intakeStatus: 'open',
    stopUntil: null,
    todayCount: 14,
    todayAmount: 39600,
  },
  {
    service: 'demaecan',
    label: '出前館',
    connectionStatus: 'connected',
    intakeStatus: 'open',
    stopUntil: null,
    todayCount: 11,
    todayAmount: 28800,
  },
  {
    service: 'rocketnow',
    label: 'ロケットナウ',
    connectionStatus: 'connected',
    intakeStatus: 'stopped',
    stopUntil: jst('13:00'),
    todayCount: 7,
    todayAmount: 18000,
  },
]

/* 絵の D-1 の 7 行。並び・件数・文字を絵に合わせる。 */
const ORDER_ROWS = [
  {
    id: 'ord-ue-1042', service: 'ubereats', orderNumber: 'UE-1042',
    status: 'new', statusLabel: '新着',
    totalAmount: 3480, itemCount: 4, itemSummary: '唐揚げ弁当×2 ほか3点',
    urgency: 'urgent', urgencyReason: '受け取り希望まで13分・品数4点・調理待ち3件のため、先に調理を始めるのがおすすめです',
    receivedAt: receivedAgo(2), wantedAt: jst('12:15'),
  },
  {
    id: 'ord-dm-8821', service: 'demaecan', orderNumber: 'DM-8821',
    status: 'new', statusLabel: '新着',
    totalAmount: 1180, itemCount: 1, itemSummary: '天丼セット×1',
    urgency: 'normal', urgencyReason: null,
    receivedAt: receivedAgo(4), wantedAt: jst('12:25'),
  },
  {
    id: 'ord-rn-310', service: 'rocketnow', orderNumber: 'RN-310',
    status: 'cooking', statusLabel: '調理中',
    totalAmount: 2560, itemCount: 4, itemSummary: 'バターチキンカレー×2 ナン×2',
    urgency: 'urgent', urgencyReason: '受け取り希望まで8分です',
    receivedAt: receivedAgo(6), wantedAt: jst('12:16'),
  },
  {
    id: 'ord-ue-1041', service: 'ubereats', orderNumber: 'UE-1041',
    status: 'cooking', statusLabel: '調理中',
    totalAmount: 2180, itemCount: 2, itemSummary: '海鮮丼×1 みそ汁×1',
    urgency: 'normal', urgencyReason: null,
    receivedAt: receivedAgo(9), wantedAt: jst('12:30'),
  },
  {
    id: 'ord-dm-8820', service: 'demaecan', orderNumber: 'DM-8820',
    status: 'cooking', statusLabel: '調理中',
    totalAmount: 4140, itemCount: 3, itemSummary: 'ハンバーグ定食×3',
    urgency: 'watch', urgencyReason: '品数が多く調理に時間がかかります',
    receivedAt: receivedAgo(12), wantedAt: jst('12:35'),
  },
  {
    id: 'ord-ue-1039', service: 'ubereats', orderNumber: 'UE-1039',
    status: 'handed_over', statusLabel: '受け渡し済み',
    totalAmount: 1160, itemCount: 1, itemSummary: '唐揚げ弁当×1',
    urgency: 'normal', urgencyReason: null,
    receivedAt: receivedAgo(18), wantedAt: jst('12:05'),
  },
  {
    id: 'ord-rn-309', service: 'rocketnow', orderNumber: 'RN-309',
    status: 'canceled', statusLabel: 'キャンセル',
    totalAmount: 980, itemCount: 1, itemSummary: 'チキンカレー×1',
    urgency: 'normal', urgencyReason: null,
    receivedAt: receivedAgo(25), wantedAt: jst('12:00'),
  },
]

export const ordersData = (tab = 'new') => ({
  success: true,
  store: STORE,
  services: SERVICES,
  kpis: {
    todayCount: 32,
    todayCountDelta: 4,
    handedOverCount: 24,
    todaySales: 86400,
    todaySalesDeltaPercent: 8,
    averageAmount: 2700,
    urgentCount: 3,
    averagePrepMinutes: 12,
    averagePrepMinutesDelta: -2,
  },
  tab,
  tabCounts: { all: 33, new: 5, cooking: 3, handed_over: 24 },
  orders: ORDER_ROWS.map(({ urgencyReason: _reason, ...rest }) => ({
    ...rest,
    serviceLabel: SERVICES.find((item) => item.service === rest.service).label,
    urgencyReason: _reason,
  })),
})

/* 絵の D-2（注文の詳細）。品目3つ・合計 ¥3,480・備考あり。 */
export const orderDetailData = () => ({
  success: true,
  order: {
    id: 'ord-ue-1042',
    service: 'ubereats',
    serviceLabel: 'Uber Eats',
    orderNumber: 'UE-1042',
    status: 'new',
    statusLabel: '新着',
    totalAmount: 3480,
    currency: 'JPY',
    itemCount: 5,
    urgency: 'urgent',
    urgencyReason: '受け取り希望まで13分・品数4点・調理待ち3件のため、先に調理を始めるのがおすすめです',
    pickupMethod: '配達（Uber Eats 配達員）',
    wantedAt: jst('12:15'),
    customerNote: 'タレ多めでお願いします',
    cancelReasonCode: null,
    canceledBy: null,
    receivedAt: jst('12:02'),
    acceptedAt: null,
    readyAt: null,
    handedOverAt: null,
    canceledAt: null,
  },
  items: [
    { name: '唐揚げ弁当', note: '特製タレ増量（無料）', quantity: 2, amount: 2160 },
    { name: 'ポテトサラダ', note: null, quantity: 1, amount: 380 },
    { name: '緑茶（500ml）', note: null, quantity: 2, amount: 440 },
  ],
})

/* 絵の D-4（注文履歴・売上）。7行・本日の合計 32件 ¥86,400。 */
export const historyData = () => ({
  success: true,
  range: { from: '2026-10-09', to: '2026-10-09' },
  filter: { service: null, status: null },
  totals: {
    count: 32,
    amount: 86400,
    canceledCount: 2,
    byService: [
      { service: 'ubereats', label: 'Uber Eats', count: 14, amount: 39600 },
      { service: 'demaecan', label: '出前館', count: 11, amount: 28800 },
      { service: 'rocketnow', label: 'ロケットナウ', count: 7, amount: 18000 },
    ],
  },
  orders: [
    { id: 'h1', service: 'ubereats', serviceLabel: 'Uber Eats', orderNumber: 'UE-1042', status: 'new', statusLabel: '新着', totalAmount: 3480, itemCount: 4, itemSummary: '唐揚げ弁当 ×2 ほか2点', receivedAt: jst('12:02'), handedOverAt: null, canceledAt: null },
    { id: 'h2', service: 'demaecan', serviceLabel: '出前館', orderNumber: 'DM-0896', status: 'cooking', statusLabel: '調理中', totalAmount: 1180, itemCount: 1, itemSummary: '親子丼セット ×1', receivedAt: jst('11:58'), handedOverAt: null, canceledAt: null },
    { id: 'h3', service: 'rocketnow', serviceLabel: 'ロケットナウ', orderNumber: 'RN-0311', status: 'cooking', statusLabel: '調理中', totalAmount: 2940, itemCount: 3, itemSummary: '日替わり弁当 ×3', receivedAt: jst('11:51'), handedOverAt: null, canceledAt: null },
    { id: 'h4', service: 'ubereats', serviceLabel: 'Uber Eats', orderNumber: 'UE-1041', status: 'handed_over', statusLabel: '受け渡し済み', totalAmount: 1460, itemCount: 2, itemSummary: '唐揚げ弁当 ×1 ほか1点', receivedAt: jst('11:45'), handedOverAt: jst('12:00'), canceledAt: null },
    { id: 'h5', service: 'demaecan', serviceLabel: '出前館', orderNumber: 'DM-0895', status: 'handed_over', statusLabel: '受け渡し済み', totalAmount: 2360, itemCount: 2, itemSummary: '焼き魚定食 ×2', receivedAt: jst('11:32'), handedOverAt: jst('11:50'), canceledAt: null },
    { id: 'h6', service: 'ubereats', serviceLabel: 'Uber Eats', orderNumber: 'UE-1040', status: 'canceled', statusLabel: 'キャンセル', totalAmount: 1200, itemCount: 3, itemSummary: 'ポテトサラダ ×2 ほか1点', receivedAt: jst('11:20'), handedOverAt: null, canceledAt: jst('11:24') },
    { id: 'h7', service: 'rocketnow', serviceLabel: 'ロケットナウ', orderNumber: 'RN-0310', status: 'handed_over', statusLabel: '受け渡し済み', totalAmount: 3120, itemCount: 7, itemSummary: '緑茶 ×4 ほか3点', receivedAt: jst('11:04'), handedOverAt: jst('11:20'), canceledAt: null },
  ],
})

/* 絵の D-5（品切れ一括設定）。8品・分類と価格を絵に合わせる。 */
const ALL_SERVICE_TAGS = SERVICES.map(({ service, label }) => ({ service, label }))

export const menuItemsData = () => ({
  success: true,
  store: STORE,
  items: [
    { id: 'm1', name: '唐揚げ弁当', category: '弁当', price: 1080, soldOut: false, soldOutAt: null, services: ALL_SERVICE_TAGS },
    { id: 'm2', name: '日替わり弁当', category: '弁当', price: 980, soldOut: false, soldOutAt: null, services: ALL_SERVICE_TAGS },
    { id: 'm3', name: '親子丼セット', category: '丼もの', price: 1180, soldOut: false, soldOutAt: null, services: ALL_SERVICE_TAGS },
    { id: 'm4', name: '焼き魚定食', category: '定食', price: 1180, soldOut: true, soldOutAt: jst('11:10'), services: ALL_SERVICE_TAGS },
    { id: 'm5', name: 'ポテトサラダ', category: '副菜', price: 380, soldOut: false, soldOutAt: null, services: ALL_SERVICE_TAGS },
    { id: 'm6', name: '特製から揚げ（単品）', category: '副菜', price: 520, soldOut: true, soldOutAt: jst('10:40'), services: ALL_SERVICE_TAGS },
    { id: 'm7', name: '緑茶（500ml）', category: 'ドリンク', price: 220, soldOut: false, soldOutAt: null, services: ALL_SERVICE_TAGS },
    { id: 'm8', name: 'ほうじ茶（500ml）', category: 'ドリンク', price: 220, soldOut: false, soldOutAt: null, services: ALL_SERVICE_TAGS },
  ],
})

/*
 * 絵の板の頭に「店舗を選ぶ欄」は無い。
 * `delivery.tsx` は店舗が1件でもあると 210px の選び欄を頭に足すので、
 * 測定では店舗0件で返して欄を出さない（会社は入れて「店舗が無い」案内も出さない）。
 */
export const restaurantSnapshot = () => ({
  success: true,
  data: {
    environment: 'staging_test',
    integrationPolicy: 'inbound_only',
    organization: {
      id: 'org-nen', account_id: 'frame-parity-account', tenant_id: 'tenant-nen',
      tenant_name: '然-NEN-', name: '然-NEN-', status: 'active',
    },
    stores: [],
    memberships: [], approvals: [], reservations: [], reservationTotal: 0,
    tables: [], inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], lineFlows: [],
  },
})

/*
 * 左メニューの出し分け。
 *
 * `apps/web/src/components/layout/sidebar.tsx` は機能設定が読めないと
 * 「機能設定を読み込めませんでした。」を出し、メニューが基本の項目だけに縮む。
 * 左メニューは測る範囲（`SIDEBAR_EDGE = 240`）の中なので、縮んだままだと
 * 絵との文字の照合が崩れる。器の作りは `scripts/visual-qa/mock-api.mjs`
 * （CIの共通の仮サーバー）と同じにそろえるが、あちらには触れていない。
 */
const FEATURES = {
  scenarios: true, broadcasts: true, templates: true, reminders: true,
  auto_replies: true, rich_menus: true, inflow_tracking: true, forms: true,
  photo_review: true, automations: true, external_integrations: true,
  friend_add_routing: true, multi_store_hierarchy: false,
  friend_fields: true, support_marks: true, saved_searches: true,
  media: true, common_vars: true, analytics: true, site_tracking: true,
  webinars: false, events: true, booking: true, visit_stamps: true, affiliates: false, mileage: true,
  ec_commerce: true, line_notifications: true, nen_campaigns: true,
  restaurant_test: true,
}

export const featureSettings = () => ({
  success: true,
  data: {
    features: FEATURES,
    sidebarOrder: null,
    sidebarItemOrder: null,
    parentChildMode: false,
    specializedFeatureKeys: ['nen_campaigns', 'photo_review', 'ec_commerce', 'line_notifications'],
    // 本物は版を返す。無いと画面の expectedVersion 付き保存の欠落に気づけない。
    version: 1,
  },
})

/*
 * 表示の出し分けも同じ値で返す。
 * `multi_store_hierarchy` は**オフのまま**にする。絵（kDQHr）の左メニューは統括ではなく、
 * 1アカウントの並び（メイン／配信／…／飲食店向け（テスト）→ デリバリー受注）で描かれている。
 *
 * なお「飲食店の画面が /hq へ飛ぶ」のはこの値ではなく、立てた開発サーバーに
 * `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true` が無いとき。
 * `apps/web/src/app/restaurant-test/layout.tsx` が server 側で `redirect('/hq')` する。
 * `docs/v8-screen-playbook.md`（§4の表）に同じ落とし穴が載っている。
 */
export const featureVisibility = () => ({
  success: true,
  data: { features: FEATURES },
})
