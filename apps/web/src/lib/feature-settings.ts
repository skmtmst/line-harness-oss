export type FeatureKey =
  | 'scenarios'
  | 'broadcasts'
  | 'templates'
  | 'reminders'
  | 'auto_replies'
  | 'rich_menus'
  | 'webinars'
  | 'inflow_tracking'
  | 'forms'
  | 'mileage'
  | 'affiliates'
  | 'multi_store_hierarchy'
  | 'multi_store_bulk_updates'
  | 'reservation_ledger'
  | 'external_reservations'
  | 'google_business_profile'
  | 'nen_campaigns'
  | 'photo_review'
  | 'ec_commerce'

export interface FeatureItem {
  id: string
  label: string
  note: string
  keys: FeatureKey[]
  badge?: '多店舗向け' | '要API申請' | '専用'
  required?: boolean
}

export interface FeatureGroup {
  id: 'basic' | 'delivery' | 'results' | 'specialized' | 'multi-store'
  label: string
  visibility: 'always' | 'specialized' | 'multi-store'
  items: FeatureItem[]
}

export type MovableFeatureGroupId = Exclude<FeatureGroup['id'], 'basic'>

export const DEFAULT_FEATURE_GROUP_ORDER: MovableFeatureGroupId[] = [
  'delivery',
  'results',
  'specialized',
  'multi-store',
]

const SIDEBAR_LABELS_BY_GROUP: Record<MovableFeatureGroupId, string[]> = {
  delivery: ['配信', 'コンテンツ'],
  results: ['成果と分析'],
  specialized: ['専用機能'],
  'multi-store': ['多店舗管理'],
}

/**
 * 保存済みのサイドバー順から、機能設定の4グループ順を復元する。
 *
 * 基本グループは常に先頭へ固定する。古い保存値や、今後追加される未知の
 * セクションがあっても、既知の4グループを欠落させない。
 */
export function featureGroupOrderFromSidebarOrder(
  sidebarOrder: string[] | null | undefined,
): MovableFeatureGroupId[] {
  const byLabel = new Map<string, MovableFeatureGroupId>()
  for (const id of DEFAULT_FEATURE_GROUP_ORDER) {
    for (const label of SIDEBAR_LABELS_BY_GROUP[id]) byLabel.set(label, id)
  }
  const restored: MovableFeatureGroupId[] = []
  for (const label of sidebarOrder ?? []) {
    const id = byLabel.get(label)
    if (id && !restored.includes(id)) restored.push(id)
  }
  return [...restored, ...DEFAULT_FEATURE_GROUP_ORDER.filter((id) => !restored.includes(id))]
}

/** サイドバーへ保存する順序。基本領域は空見出しのセクションとして先頭固定。 */
export function sidebarOrderFromFeatureGroupOrder(order: MovableFeatureGroupId[]): string[] {
  const normalized = featureGroupOrderFromSidebarOrder(
    order.flatMap((id) => SIDEBAR_LABELS_BY_GROUP[id]),
  )
  return [
    '',
    ...normalized.flatMap((id) => SIDEBAR_LABELS_BY_GROUP[id]),
    '自動化',
    '予約',
    '設定',
  ]
}

export const FEATURE_SETTINGS_UPDATED_EVENT = 'line-harness:feature-settings-updated'
export const SPECIALIZED_FEATURE_KEYS: FeatureKey[] = ['nen_campaigns', 'photo_review', 'ec_commerce']
// 然の設計確認用。実機能の利用判定とは切り離し、最下部に仮置きする。
export const NEN_SHOW_MULTI_STORE = true

export const DEFAULT_FEATURES: Record<FeatureKey, boolean> = {
  scenarios: true,
  broadcasts: true,
  templates: true,
  reminders: true,
  auto_replies: true,
  rich_menus: true,
  webinars: false,
  inflow_tracking: true,
  forms: true,
  mileage: true,
  affiliates: false,
  multi_store_hierarchy: false,
  multi_store_bulk_updates: false,
  reservation_ledger: false,
  external_reservations: false,
  google_business_profile: false,
  nen_campaigns: true,
  photo_review: true,
  ec_commerce: true,
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'basic',
    label: '基本',
    visibility: 'always',
    items: [
      {
        id: 'inbox',
        label: '受信箱',
        note: 'LINEとメールの問い合わせをまとめて扱います',
        keys: [],
        required: true,
      },
      {
        id: 'friends',
        label: '友だち',
        note: '友だちの検索・タグ付け・対応状況',
        keys: [],
        required: true,
      },
      {
        id: 'friend-attributes',
        label: '友だち属性',
        note: 'タグ・友だち情報欄・保存した検索・対応マーク',
        keys: [],
        required: true,
      },
    ],
  },
  {
    id: 'delivery',
    label: '配信',
    visibility: 'always',
    items: [
      { id: 'scenarios', label: 'シナリオ配信', note: 'タイミングを指定した順次配信と分岐', keys: ['scenarios'] },
      { id: 'broadcasts', label: '一斉配信', note: '条件を指定した友だちへのまとめ送信', keys: ['broadcasts'] },
      { id: 'templates-reminders', label: 'テンプレート／リマインダ', note: '差し込み変数付きの文面と、日付起点の配信', keys: ['templates', 'reminders'] },
      { id: 'auto-replies', label: '自動応答', note: '受信メッセージへの自動返信', keys: ['auto_replies'] },
      { id: 'rich-menus', label: 'リッチメニュー', note: 'トーク下部のメニューと出し分け', keys: ['rich_menus'] },
      { id: 'webinars', label: 'ウェビナー', note: '動画セミナーの申込と視聴管理', keys: ['webinars'] },
    ],
  },
  {
    id: 'results',
    label: '成果と分析',
    visibility: 'always',
    items: [
      { id: 'inflow', label: '流入経路', note: 'URLごとのクリックと友だち追加の計測', keys: ['inflow_tracking'] },
      { id: 'forms', label: '回答フォーム', note: 'フォームの作成と、友だち情報欄への記録', keys: ['forms'] },
      { id: 'mileage', label: 'マイル', note: '購入・紹介でたまるポイント', keys: ['mileage'] },
      { id: 'affiliates', label: '成果とアフィリエイト', note: '成果地点の定義と、紹介者への報酬管理', keys: ['affiliates'] },
    ],
  },
  {
    id: 'specialized',
    label: 'この契約の専用機能',
    visibility: 'specialized',
    items: [
      { id: 'nen-health', label: '健康記録とケアフラグ', note: '体調の記録と、異常が続いたときの自動検知', keys: ['nen_campaigns'], badge: '専用' },
      { id: 'photo-review', label: '写真審査', note: '投稿された写真の確認と承認', keys: ['photo_review'], badge: '専用' },
      { id: 'ec-commerce', label: 'EC連携', note: '購入・定期便の情報を取り込みます', keys: ['ec_commerce'], badge: '専用' },
    ],
  },
  {
    id: 'multi-store',
    label: '多店舗管理',
    visibility: 'multi-store',
    items: [
      { id: 'store-hierarchy', label: '本部・店舗の階層管理', note: '本部アカウントの下に店舗をぶら下げ、店舗に入って操作します', keys: ['multi_store_hierarchy'], badge: '多店舗向け' },
      { id: 'bulk-updates', label: '全店舗の一括更新', note: '営業時間・休業日・投稿を選んだ店舗にまとめて反映します', keys: ['multi_store_bulk_updates'], badge: '多店舗向け' },
      { id: 'reservation-ledger', label: '予約台帳・座席管理', note: '席別のタイムラインで予約を一元管理します', keys: ['reservation_ledger'], badge: '多店舗向け' },
      { id: 'external-reservations', label: '外部予約サイトの取り込み', note: '予約確定メールを解析して取り込み、重複を検出します', keys: ['external_reservations'], badge: '多店舗向け' },
      { id: 'google-business-profile', label: 'Googleビジネスプロフィール連携', note: '営業時間・休業日・投稿・画像をAPIで更新します', keys: ['google_business_profile'], badge: '要API申請' },
    ],
  },
]

export const SIDEBAR_FEATURE_BY_HREF: Partial<Record<string, FeatureKey>> = {
  '/scenarios': 'scenarios',
  '/broadcasts': 'broadcasts',
  '/templates': 'templates',
  '/reminders': 'reminders',
  '/auto-replies': 'auto_replies',
  '/rich-menus': 'rich_menus',
  '/webinars': 'webinars',
  '/inflow-links': 'inflow_tracking',
  '/form-submissions': 'forms',
  '/scoring': 'mileage',
  '/conversions': 'affiliates',
  '/nen-campaigns': 'nen_campaigns',
  '/nen-members': 'photo_review',
  '/ec-commerce': 'ec_commerce',
}

export function itemIsEnabled(item: FeatureItem, features: Record<string, boolean>): boolean {
  if (item.required || item.keys.length === 0) return true
  return item.keys.every((key) => features[key] !== false)
}

export function groupFeatureCount(group: FeatureGroup): number {
  return group.items.reduce((count, item) => count + item.keys.length, 0)
}

export function groupEnabledCount(group: FeatureGroup, features: Record<string, boolean>): number {
  return group.items.reduce(
    (count, item) => count + item.keys.filter((key) => features[key] !== false).length,
    0,
  )
}

export function visibleFeatureGroups(options: {
  showMultiStore: boolean
  specializedFeatureKeys: string[]
}): FeatureGroup[] {
  const specialized = new Set(options.specializedFeatureKeys)
  return FEATURE_GROUPS.filter((group) => {
    if (group.visibility === 'multi-store') return options.showMultiStore
    if (group.visibility === 'specialized') {
      return group.items.some((item) => item.keys.some((key) => specialized.has(key)))
    }
    return true
  }).map((group) =>
    group.visibility === 'specialized'
      ? {
          ...group,
          items: group.items.filter((item) => item.keys.some((key) => specialized.has(key))),
        }
      : group,
  )
}
