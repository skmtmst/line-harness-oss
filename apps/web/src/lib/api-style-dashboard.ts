import { fetchApi } from './api'

/*
 * 業種ダッシュボード（B-294・B-304・B-309・B-318。絵 XBkC2）の口。
 * 本物の口は API 組4（codex/kenta-api4-1015）が作り中。ここは画面が読む形だけを先に決め、
 * 撮影の見本（scripts/visual-qa/style-dashboard-mock.mjs）が同じ形で返す。
 * 口が無い（404 など）ときは画面側が「読み込めませんでした」を出す（飲食は今の口から組み立てる）。
 */

export type UsageStyle = 'standard' | 'restaurant' | 'salon' | 'consult' | 'lesson' | 'ec'
export type IndustryStyle = 'restaurant' | 'salon' | 'consult' | 'lesson'
export type DashboardRange = 'today' | 'week' | 'month'
export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export interface StyleKpi {
  id: string
  title: string
  value: number | null
  /** 「¥32,400」のように整形済みで出す値。 */
  valueText?: string
  unit: string
  delta?: { text: string; tone: 'up' | 'down' | 'attention' } | null
  detail: string
  link?: { label: string; href: string } | null
  help: string
}

export interface StyleAlertAction { id: string; label: string; icon?: 'external' | 'check' | 'refresh' | 'link' | 'people'; href?: string; taskId?: string }
export interface StyleAlert { id: string; title: string; detail: string; actions: StyleAlertAction[] }

export interface StyleBadge { label: string; tone: Tone }

export interface StyleRow {
  id: string
  /** 飲食の予約の ID（来店の印などの本物の口に渡す）。 */
  reservationId?: string
  time: string
  endTime?: string
  name: string
  sub?: string
  people?: number
  seat?: string
  course?: string
  courseNote?: string
  meet?: StyleBadge
  staff?: string
  pay?: StyleBadge
  state?: StyleBadge
  /** 行の右の操作。visit＝来店（ボタン）・undo＝取り消す（文字）・meet＝Meet に入る・place＝場所を開く・done＝済み（文字）。 */
  action?: 'visit' | 'undo' | 'meet' | 'place' | 'done' | null
  actionHref?: string
  /** 教室：予約／定員・待ち・空き。 */
  booked?: number
  capacity?: number
  waiting?: number
  vacancy?: '×' | '△' | '○'
  highlight?: boolean
}

export interface StyleBoardColumn { id: string; name: string; initial: string; tone: 'green' | 'purple' | 'blue' | 'amber'; count: number; next: string; off?: boolean }
export interface StyleBoardEntry {
  id: string
  columnId: string
  start: string
  end: string
  name: string
  menu: string
  state: 'done' | 'active' | 'booked' | 'pending' | 'off'
  stateLabel: string
  nominated?: boolean
  unpaid?: boolean
  selected?: boolean
}
export interface StyleBoard {
  from: string
  to: string
  now?: string
  next?: string
  columns: StyleBoardColumn[]
  entries: StyleBoardEntry[]
  free: { columnId: string; start: string }[]
}

export interface StyleSideRow { label: string; value: string; tone?: 'danger' }
export interface StyleSideCard {
  id: string
  title: string
  help?: string
  link?: { label: string; href: string } | null
  rows: StyleSideRow[]
  action?: { label: string; icon?: 'send' | 'line' } | null
  more?: { label: string; href: string } | null
}

export interface StyleWeekDay { date: string; label: string; sub: string; closed?: boolean; today?: boolean }
export interface StyleWeek {
  title: string
  from: string
  to: string
  days: StyleWeekDay[]
  entries: { id: string; day: string; start: string; end: string; title: string; name: string }[]
  free: { day: string; start: string; end: string }[]
}
export interface StyleMonthDay { date: string; day: string; inMonth: boolean; closed?: boolean; groups?: number; people?: number; empty?: boolean; mark?: StyleBadge | null; today?: boolean }
export interface StyleMonth {
  title: string
  days: StyleMonthDay[]
  selected: { title: string; total: string; rows: { time: string; name: string; sub: string; state: StyleBadge }[]; moreLabel: string }
}

export interface StyleRoster {
  rowId: string
  head: string
  title: string
  pay: StyleBadge
  meta: string
  members: { name: string; sub: string; pay: StyleBadge; attend: 'done' | 'button' | 'cancel' }[]
  more: string
  payLinkCount: number
}

export interface StyleToday {
  style: IndustryStyle
  asOf: string
  hoursLabel?: string | null
  staff: { id: string; name: string }[]
  kpis: StyleKpi[]
  alert?: StyleAlert | null
  rows: StyleRow[]
  rowsNote: string
  board?: StyleBoard | null
  week?: StyleWeek | null
  month?: StyleMonth | null
  roster?: StyleRoster | null
  side: StyleSideCard[]
}

export interface StyleAnalyticsCell { text: string; note?: string; badge?: StyleBadge }
export interface StyleAnalytics {
  tabs: { id: string; label: string }[]
  tab: string
  cards: { id: string; title: string; valueText: string; unit?: string; delta?: { text: string; tone: 'up' | 'down' } | null; help: string }[]
  chart: { title: string; help: string; ticks: string[]; axis: string[]; points: { label: string; now: number; prev: number }[]; max: number }
  table: { title: string; help: string; link?: { label: string; href: string } | null; columns: { label: string; align?: 'right' }[]; rows: { id: string; name: string; sub: string; cells: StyleAnalyticsCell[] }[]; note?: string }
  side: (StyleSideCard & { bars?: { label: string; value: string; ratio: number }[]; split?: { ratio: number }; note?: string })[]
}

export interface StyleLayoutItem { id: string; label: string; on: boolean }
export interface StyleLayout { base: string; changed: number; kpis: StyleLayoutItem[]; cards: StyleLayoutItem[]; maxKpis: number }

export interface StyleClosureInput {
  date: string
  allDay: boolean
  from?: string
  to?: string
  target: 'store' | 'staff' | 'seat'
  ids: string[]
  reason: string
}

const q = (params: Record<string, string | undefined>) =>
  Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&')

export const styleDashboardApi = {
  /** アカウントの使い方のスタイル（B-294）。無い・読めないときは標準のダッシュボード。 */
  accountStyle: (accountId: string) =>
    fetchApi<{ success: boolean; data: { style: UsageStyle } }>(`/api/account-style?${q({ account_id: accountId })}`),
  today: (accountId: string, style: IndustryStyle, params: { range: DashboardRange; date: string; staff?: string; compare?: string }) =>
    fetchApi<{ success: boolean; data: StyleToday }>(`/api/style-dashboard/today?${q({ account_id: accountId, style, ...params })}`),
  analytics: (accountId: string, style: IndustryStyle, params: { days: string; tab?: string; staff?: string; compare?: string }) =>
    fetchApi<{ success: boolean; data: StyleAnalytics }>(`/api/style-dashboard/analytics?${q({ account_id: accountId, style, ...params })}`),
  layout: (accountId: string, style: IndustryStyle) =>
    fetchApi<{ success: boolean; data: StyleLayout }>(`/api/style-dashboard/layout?${q({ account_id: accountId, style })}`),
  saveLayout: (accountId: string, style: IndustryStyle, layout: Pick<StyleLayout, 'kpis' | 'cards'>) =>
    fetchApi<{ success: boolean; data: StyleLayout }>(`/api/style-dashboard/layout?${q({ account_id: accountId, style })}`, { method: 'PUT', body: JSON.stringify(layout) }),
  resetLayout: (accountId: string, style: IndustryStyle) =>
    fetchApi<{ success: boolean; data: StyleLayout }>(`/api/style-dashboard/layout?${q({ account_id: accountId, style })}`, { method: 'DELETE' }),
  addClosure: (accountId: string, style: IndustryStyle, input: StyleClosureInput) =>
    fetchApi<{ success: boolean; data: { id: string; affected: number } }>(`/api/style-dashboard/closures?${q({ account_id: accountId, style })}`, { method: 'POST', body: JSON.stringify(input) }),
}
