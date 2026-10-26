import type { ComponentProps } from 'react'
import type { AccountStyle, ReservationBoardEntry, ReservationBoardResource, RestaurantFloor, StyleMetricId } from '@line-crm/shared'
import type { BookingAvailabilitySlot } from '@/lib/api'
import type { LiffPhoneDatetimeStep, LiffPhoneMenuStep, LiffPhoneStaffStep } from '@/v8/booking-menus'
import type { FormPhone } from '@/v8/form-edit'
import type { StyleBoard, StyleRow, StyleSideCard } from '@/v8/style-dashboard'
import type { StarterButton } from '../use-starter-menu'

/*
 * スタイル体験の見本の台本の型。中身は作り物のデータだけ。
 * 部品へ渡す値は、その部品の props・本線の型から作る（別名の形を作らない）。
 * 日時は「今日の日本時間から何日後・何時」で持ち、描く時に組み立てる。
 */

export type StyleExperienceStepKey =
  | 'reserve' | 'accept' | 'remind' | 'visit' | 'thanks'
  | 'follow' | 'inbox' | 'reply' | 'broadcast' | 'form' | 'coupon' | 'buy'

/** このスタイルでできること。basis は本線の根拠（画面には出さない）。 */
export type StyleExperienceCan = { text: string; basis: string }

/** 何日後（0＝今日）と時刻（HH:MM）。 */
export type RelativeTime = { day: number; time: string }

/** starter は初期セットの項目の key。付けた文は初期セットの文と同じ（script.test.ts が照らす）。 */
export type TalkMessage = { from: 'shop' | 'customer'; text: string; time: string; starter?: 'welcome' | 'reminder-day-before' | 'reminder-thanks' }

/** 席の予約の見本（LIFF の「人数・日時・コース」の並び）。 */
export type SeatPickSample = {
  guestCount: number
  date: RelativeTime
  times: Array<{ time: string; available: boolean }>
  picked: string
  course: string
}

/** 確認・受け付けました の見本（LIFF の予約内容の箱の並び）。 */
export type BookingFactsSample = {
  heading: string
  body?: string
  done: boolean
  facts: Array<{ label: string; value: string } | { label: string; at: RelativeTime }>
}

type DatetimeProps = ComponentProps<typeof LiffPhoneDatetimeStep>
export type DatetimeSample = Omit<DatetimeProps, 'slots'> & {
  slots: Array<Omit<BookingAvailabilitySlot, 'date' | 'startUtc' | 'endUtc'> & { day: number }>
}

export type PhoneScene =
  | { part: 'seat-pick'; title: string; step: number; data: SeatPickSample }
  | { part: 'booking-facts'; title: string; step: number; steps: string[]; data: BookingFactsSample }
  | { part: 'booking-menu'; data: ComponentProps<typeof LiffPhoneMenuStep> }
  | { part: 'booking-staff'; data: ComponentProps<typeof LiffPhoneStaffStep> }
  | { part: 'booking-datetime'; data: DatetimeSample }
  | { part: 'form'; data: ComponentProps<typeof FormPhone> }
  | { part: 'line-talk'; data: { caption: string; messages: TalkMessage[]; richMenu?: boolean } }

/** 共通のダッシュボード（標準・EC）の数。 */
export type CommonMetricId = 'friends' | 'unreplied' | 'deliveries' | 'orders'
export type SampleKpi = { metric: StyleMetricId | CommonMetricId; value: number | null; valueText?: string; unit: string }

/** 標準・EC のダッシュボードのカード。id は初期セットのカードの id。 */
export type CommonCard = { id: 'inbox' | 'deliveries' | 'ec-orders' | 'ec-repeat'; card: StyleSideCard }

export type DashboardScene = {
  kpis: SampleKpi[]
  rows?: StyleRow[]
  side?: StyleSideCard[]
  cards?: CommonCard[]
}

export type SampleReservation = Omit<ReservationBoardEntry, 'startsAt' | 'endsAt'> & { day: number; start: string; end: string }

export type BoardScene =
  | { kind: 'reservation-board'; data: { entries: SampleReservation[]; resources: ReservationBoardResource[] }; selectedId?: string }
  | { kind: 'floor-map'; data: { floor: RestaurantFloor; resources: ReservationBoardResource[] } }
  | { kind: 'staff-board'; data: StyleBoard }
  | { kind: 'cards'; data: StyleSideCard[] }

export type StyleExperienceScene = {
  step: StyleExperienceStepKey
  /** この段を見せる長さ（3000〜4000）。 */
  ms: number
  /** 場面の「できること」の 1 行（読み上げにも使う）。 */
  line: string
  phone: PhoneScene
  dashboard: DashboardScene
  /** 全部版の右の画面。無いスタイルは最小版だけ（全部版の札に出さない）。 */
  board?: BoardScene
}

export type StyleExperienceStyle = {
  /** styleTerm(style,'V01') と同じ。 */
  label: string
  /** お客さまの画面に出す店名（今の見本の名前）。 */
  account: string
  can: [StyleExperienceCan, StyleExperienceCan, StyleExperienceCan]
  steps: Array<{ key: StyleExperienceStepKey; label: string }>
  scenes: StyleExperienceScene[]
  /** トークの下に出すリッチメニュー。無いスタイルは出さない。 */
  richMenu?: StarterButton[]
}

export type StyleExperienceScript = {
  version: 1
  order: AccountStyle[]
  /** 全部版の上の札。「標準・EC」は 2 つを続けて流す。 */
  tabs: Array<{ label: string; styles: AccountStyle[] }>
  styles: Record<AccountStyle, StyleExperienceStyle>
}
