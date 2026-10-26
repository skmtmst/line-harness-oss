'use client'

import type { AccountStyle } from '@line-crm/shared'
import { PREPARING_WORD } from '@/components/shared/preparing-dialog'
import StatusBadge from '@/components/shared/status-badge'
import { styleTerm } from '@/lib/terms'
import styles from './style-experience-stand-in.module.css'

/*
 * スタイル体験プレイヤー（SPEC-12）が入るまでの仮の部品。口（props）は共通節 S-4 のまま。
 * 本物が入ったら、読む側（style-choice-step.tsx）の import を本物へ替えてこのファイルを消す。
 * 台本は本物と同じ形の一部（できること 3 行）だけを持つ。本線にある物だけを書く。
 */

type Can = { text: string; basis: string }

export type StyleExperienceScript = {
  version: 1
  order: AccountStyle[]
  styles: Record<AccountStyle, { label: string; can: [Can, Can, Can] }>
}

export type StyleExperiencePlayerProps = {
  script: StyleExperienceScript
  style: AccountStyle
  onStyleChange?: (style: AccountStyle) => void
  switcher: 'segmented' | 'external'
  variant: 'minimal' | 'full'
  data?: 'sample' | { accountId: string }
  record?: boolean
}

const label = (style: AccountStyle) => styleTerm(style, 'V01')

export const STYLE_EXPERIENCE_SCRIPT: StyleExperienceScript = {
  version: 1,
  order: ['restaurant', 'salon', 'consult', 'lesson', 'standard', 'ec'],
  styles: {
    restaurant: { label: label('restaurant'), can: [
      { text: 'LINE から席・人数・コースの予約を受けられます', basis: 'liff/pages/seat' },
      { text: '空いている卓に割り当て、空席と卓の稼働率を数えます', basis: 'STYLE_DEFAULT_METRIC_IDS.restaurant' },
      { text: '帰ったあとに来店のお礼を送れます（止めた状態で入ります）', basis: 'standardStarter.restaurant.reminder-thanks' },
    ] },
    salon: { label: label('salon'), can: [
      { text: '担当者とメニューを選んで予約を受けられます', basis: 'liff booking menu → staff → datetime' },
      { text: '担当ごとの予定と次回予約率が見られます', basis: 'STYLE_DEFAULT_METRIC_IDS.salon.nextBookingRate' },
      { text: '前日のお知らせと来店のお礼を送れます（止めた状態で入ります）', basis: 'standardStarter.salon.reminders' },
    ] },
    consult: { label: label('consult'), can: [
      { text: 'LINE から面談を予約し、オンライン（Google Meet）か対面を選べます', basis: 'MeetingModeChoices' },
      { text: '担当を自動で割り当て、結果待ちを数えます', basis: 'STYLE_DEFAULT_METRIC_IDS.consult.resultPending' },
      { text: '前日・当日の案内と面談のお礼を送れます（止めた状態で入ります）', basis: 'standardStarter.consult.reminders' },
    ] },
    lesson: { label: label('lesson'), can: [
      { text: 'LINE からクラスを予約でき、回数券が自動で使われます', basis: 'liff/pages/event + event-entitlements' },
      { text: 'クラスの定員・教室の埋まりと出欠が見られます', basis: 'STYLE_DEFAULT_METRIC_IDS.lesson' },
      { text: 'クラスの前日の案内と参加のお礼を送れます（止めた状態で入ります）', basis: 'standardStarter.lesson.reminders' },
    ] },
    standard: { label: label('standard'), can: [
      { text: '友だち追加で、あいさつとリッチメニューが届きます', basis: 'standardStarter.standard' },
      { text: 'お問い合わせは受信箱でまとめて返せます', basis: 'v8/inbox-chat' },
      { text: 'お知らせを一斉配信できます', basis: 'v8/broadcasts' },
    ] },
    ec: { label: label('ec'), can: [
      { text: '友だち追加の経路にクーポンを付けて渡せます', basis: 'liff entry-route-coupon' },
      { text: 'お店の EC サイトをつなぐと、注文の数がダッシュボードに出ます', basis: 'v8/dashboard/ec-summary' },
      { text: '購入のお礼・再入荷のお知らせの見本が入ります', basis: 'style-template-samples.ec' },
    ] },
  },
}

/** 見本の枠の中身。大きさは枠（読む側）が決め、ここは中を埋めるだけ。 */
export function StyleExperiencePlayer({ script, style }: StyleExperiencePlayerProps) {
  return (
    <div className={styles.stage} role="img" aria-label={`${script.styles[style].label}の動く見本（${PREPARING_WORD}）`}>
      <StatusBadge tone="neutral" dot>{PREPARING_WORD}</StatusBadge>
      <p className={styles.line}>{`${script.styles[style].label}の動く見本は、まもなくここで見られます`}</p>
    </div>
  )
}
