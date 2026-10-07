/*
 * ダッシュボードの配置の初期値・正規化（V8 速さ対応）。
 *
 * `dashboard-editor.tsx` から純粋な部分だけを抜いたもの。
 * 編集パネル自体（dnd-kit を含む）は開くまで読まないが、
 * 初期値・正規化は起動直後に要るため、軽いこの口から読む。
 * 中身は移しただけで変えていない。名前・説明・既定ON/OFFだけを
 * ここで持ち、IDと区分は共有定義から組み立てる（DASH-01）。
 */
import {
  DASHBOARD_CARD_GROUPS,
  type DashboardCardGroup,
  type DashboardCardId,
} from '@line-crm/shared'

export type { DashboardCardId } from '@line-crm/shared'

export type DashboardGroup = DashboardCardGroup

export type DashboardPreferenceItem = {
  id: DashboardCardId
  visible: boolean
}

export type DashboardPreferences = Record<DashboardGroup, DashboardPreferenceItem[]>

export type CardDefinition = {
  id: DashboardCardId
  label: string
  description: string
  group: DashboardGroup
  defaultVisible: boolean
}

/** カードの名前・説明・既定ON/OFF。キーは共有定義のIDと完全一致する（型で強制）。 */
const CARD_META: Record<DashboardCardId, { label: string; description: string; defaultVisible: boolean }> = {
  'today-inbox': { label: '対応が必要な受信', description: '上部・小カード', defaultVisible: true },
  'today-photo-review': { label: '写真審査', description: '上部・小カード', defaultVisible: true },
  'today-bookings': { label: '今日の予約', description: '上部・小カード', defaultVisible: true },
  'today-shipments': { label: '出荷予定件数', description: '上部・小カード', defaultVisible: true },
  'shipment': { label: '出荷予定', description: 'メイン・横長', defaultVisible: true },
  'pending-inbox': { label: '対応が必要な受信一覧', description: 'メイン・横長', defaultVisible: true },
  'friend-trend': { label: '友だち数の推移', description: 'メイン・横長', defaultVisible: true },
  'friend-add': { label: '友だち追加リンク', description: 'メイン・左カラム', defaultVisible: true },
  'scenario-status': { label: 'シナリオ配信状況', description: 'メイン｜配信中・停止中', defaultVisible: false },
  'uid-migration': { label: 'UID移行状況', description: 'メイン｜移行の進捗', defaultVisible: false },
  'send-quota': { label: '今月の送信枠', description: '右サイド', defaultVisible: true },
  'operational-alerts': { label: '運用アラート', description: '右サイド', defaultVisible: true },
  'connection-status': { label: '接続状態', description: '右サイド', defaultVisible: true },
  'support-mark-status': { label: '現在の対応状況', description: '右サイド', defaultVisible: true },
  'friend-status': { label: '友だちの状態', description: '右サイド｜有効数・ブロック率', defaultVisible: false },
  /* M: 予約だけでなく予約配信・リマインダも載せるので、表題と名前を「今後の予定」にした。 */
  'upcoming': { label: '今後の予定', description: '右サイド', defaultVisible: true },
  /* L (#824): 通知の送達台帳から数えた今日の失敗。出どころはカードの「？」に出す。 */
  'delivery-failures': { label: '配信の失敗', description: '右サイド｜今日・出どころ付き', defaultVisible: true },
  'monthly-delivery': { label: '今月の配信', description: '右サイド', defaultVisible: true },
  'recent-results': { label: '最近の成果', description: '右サイド', defaultVisible: true },
  'booking-status': { label: '予約状況', description: '右サイド｜本日・変更・キャンセル', defaultVisible: false },
  'inflow-top': { label: '流入経路TOP3', description: '右サイド｜直近7日の上位経路', defaultVisible: false },
  'funnel-alert': { label: 'ファネル要注意', description: '右サイド｜離脱率が基準超過時', defaultVisible: false },
  'automation-failures': { label: 'オートメーション失敗', description: '右サイド｜失敗した処理', defaultVisible: false },
}

export const DASHBOARD_CARD_DEFINITIONS: CardDefinition[] = (
  Object.keys(DASHBOARD_CARD_GROUPS) as DashboardGroup[]
).flatMap((group) =>
  DASHBOARD_CARD_GROUPS[group].map((id) => ({ id, group, ...CARD_META[id] })),
)

/** 既定ON/OFFの差し替え（画面の版ごと）。保存済みの設定には効かない。 */
export type DashboardDefaultVisibility = Partial<Record<DashboardCardId, boolean>>

/**
 * V8 の既定。絵（d8X09）は「友だち追加リンク」の右に「友だちの状態」を置く。
 * v7 の既定（OFF）は変えない。
 */
export const V8_DASHBOARD_DEFAULT_VISIBILITY: DashboardDefaultVisibility = { 'friend-status': true }

export function defaultDashboardPreferences(overrides?: DashboardDefaultVisibility): DashboardPreferences {
  const visibleOf = (card: CardDefinition) => overrides?.[card.id] ?? card.defaultVisible
  return {
    today: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'today').map((card) => ({ id: card.id, visible: visibleOf(card) })),
    main: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'main').map((card) => ({ id: card.id, visible: visibleOf(card) })),
    right: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'right').map((card) => ({ id: card.id, visible: visibleOf(card) })),
  }
}

/** 保存済み設定へ追加カードを補い、知らないIDと重複を取り除く。 */
export function normalizeDashboardPreferences(value: unknown, overrides?: DashboardDefaultVisibility): DashboardPreferences {
  const defaults = defaultDashboardPreferences(overrides)
  if (!value || typeof value !== 'object') return defaults
  const input = value as Partial<Record<DashboardGroup, unknown>>

  const normalizeGroup = (group: DashboardGroup): DashboardPreferenceItem[] => {
    const allowed = new Map(defaults[group].map((item) => [item.id, item] as const))
    const normalized: DashboardPreferenceItem[] = []
    if (Array.isArray(input[group])) {
      for (const candidate of input[group]) {
        if (!candidate || typeof candidate !== 'object') continue
        const item = candidate as Partial<DashboardPreferenceItem>
        if (!item.id || !allowed.has(item.id) || normalized.some((entry) => entry.id === item.id)) continue
        normalized.push({ id: item.id, visible: item.visible !== false })
      }
    }
    for (const item of defaults[group]) {
      if (!normalized.some((entry) => entry.id === item.id)) normalized.push(item)
    }
    return normalized
  }

  return {
    today: normalizeGroup('today'),
    main: normalizeGroup('main'),
    right: normalizeGroup('right'),
  }
}
