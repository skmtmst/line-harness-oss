import { styleTerm } from '@/lib/terms'
import type { DashboardRange, IndustryStyle } from './model'

/*
 * 4 業種のダッシュボードの違い（・。絵 XBkC2：NqAvL 飲食・mOAX5 サロン・R0FFqz 面談・k2MBw 教室）。
 * 骨組みは同じ。違うのは題・タブ・表示の切り替え・担当の呼び方・主ボタン・表の列・行の「…」だけ。
 */

export type DashboardTab = 'main' | 'bookings' | 'people' | 'analytics'
export type DashboardView = 'board' | 'floor' | 'list' | 'calendar'

export interface StyleConfig {
  title: string
  help: string
  tabs: Record<DashboardTab, string>
  views: { value: DashboardView; label: string }[]
  /** 担当のプルダウンの呼び方（席・担当・講師）。 */
  staffNoun: string
  primary: string
  walkIn: boolean
  search: string
  /** 一覧の表の初期の表示。 */
  defaultView: DashboardView
  /** ほかのタブで開く今の画面。 */
  links: { bookings: string; people: string }
  analyticsDefault: string
}

export const RANGES: { value: DashboardRange; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '1週間' },
  { value: 'month', label: '1か月' },
]

export const STYLE_CONFIG: Record<IndustryStyle, StyleConfig> = {
  restaurant: {
    title: styleTerm('restaurant', 'V02'),
    help: 'お店の予約と、今日やることをまとめて見る画面です。数える日は来店日です。予約が入った日で数えるのは「新着予約」だけです。',
    tabs: { main: styleTerm('restaurant', 'V03'), bookings: styleTerm('restaurant', 'V06'), people: styleTerm('restaurant', 'V11'), analytics: '分析' },
    views: [
      { value: 'board', label: '盤（時間×卓）' },
      { value: 'floor', label: '座席表' },
      { value: 'list', label: '一覧' },
      { value: 'calendar', label: 'カレンダー' },
    ],
    staffNoun: styleTerm('restaurant', 'V08'),
    primary: styleTerm('restaurant', 'V20'),
    walkIn: true,
    search: '名前・タグ・メモで探す',
    defaultView: 'list',
    links: { bookings: '/restaurant-test/reservations', people: '/friends' },
    analyticsDefault: 'payments',
  },
  salon: {
    title: styleTerm('salon', 'V02'),
    help: 'サロンの台帳と、今日やることをまとめて見る画面です。数える日は来店日です。予約が入った日で数えるのは「新着予約」だけです。',
    tabs: { main: styleTerm('salon', 'V03'), bookings: styleTerm('salon', 'V06'), people: styleTerm('salon', 'V11'), analytics: '分析' },
    views: [
      { value: 'board', label: '盤（時間×担当）' },
      { value: 'list', label: '一覧' },
      { value: 'calendar', label: 'カレンダー' },
    ],
    staffNoun: styleTerm('salon', 'V08'),
    primary: styleTerm('salon', 'V20'),
    walkIn: false,
    search: '名前・電話で探す',
    defaultView: 'board',
    links: { bookings: '/booking/bookings', people: '/friends' },
    analyticsDefault: 'overview',
  },
  consult: {
    title: styleTerm('consult', 'V02'),
    help: '面談・相談の予定と、今日やることをまとめて見る画面です。数える日は面談日です。予約が入った日で数えるのは「新着予約」だけです。',
    tabs: { main: styleTerm('consult', 'V03'), bookings: styleTerm('consult', 'V06'), people: styleTerm('consult', 'V11'), analytics: '分析' },
    views: [
      { value: 'board', label: '盤（時間×担当）' },
      { value: 'list', label: '一覧' },
      { value: 'calendar', label: 'カレンダー' },
    ],
    staffNoun: styleTerm('consult', 'V08'),
    primary: styleTerm('consult', 'V20'),
    walkIn: false,
    search: '名前・タグ・メモで探す',
    defaultView: 'list',
    links: { bookings: '/booking/bookings', people: '/friends' },
    analyticsDefault: 'overview',
  },
  lesson: {
    title: styleTerm('lesson', 'V02'),
    help: '教室・レッスンのクラスと、今日やることをまとめて見る画面です。数える日はクラスの日です。予約が入った日で数えるのは「新着予約」だけです。',
    tabs: { main: styleTerm('lesson', 'V03'), bookings: styleTerm('lesson', 'V06'), people: styleTerm('lesson', 'V11'), analytics: '分析' },
    views: [
      { value: 'board', label: '盤（時間×講師）' },
      { value: 'list', label: '一覧' },
      { value: 'calendar', label: 'カレンダー' },
    ],
    staffNoun: styleTerm('lesson', 'V08'),
    primary: styleTerm('lesson', 'V20'),
    walkIn: false,
    search: '名前・クラスで探す',
    defaultView: 'list',
    links: { bookings: '/events', people: '/friends' },
    analyticsDefault: 'payments',
  },
}

export const TAB_KEYS: DashboardTab[] = ['main', 'bookings', 'people', 'analytics']

/** URL の ?tab= の値（日本語の名前は URL に出さない）。 */
export const TAB_PARAM: Record<DashboardTab, string> = { main: 'today', bookings: 'bookings', people: 'people', analytics: 'analytics' }

export function tabFromParam(value: string | null): DashboardTab {
  const hit = (Object.entries(TAB_PARAM) as [DashboardTab, string][]).find(([, v]) => v === value)
  return hit ? hit[0] : 'main'
}

export function viewFromParam(style: IndustryStyle, value: string | null): DashboardView {
  const views = STYLE_CONFIG[style].views.map((v) => v.value)
  return views.includes(value as DashboardView) ? (value as DashboardView) : STYLE_CONFIG[style].defaultView
}

export function rangeFromParam(value: string | null): DashboardRange {
  return value === 'week' || value === 'month' ? value : 'today'
}
