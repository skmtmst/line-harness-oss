/*
 * 利用規約の同意の決まり（今の画面 app/restaurant-test/stores/new/terms-state.ts から写した）。
 * src/v8 からは @/app を読めないので写す。中身を変えるときは両方を直す。
 */
import { TERMS_DOCUMENT } from '@/content/terms/musubo-terms'

export const STEP = {
  TERMS: 1,
  BASICS: 2,
  OFFICIAL_ACCOUNT: 3,
  CREDENTIALS: 4,
  CONNECT: 5,
} as const

export const TERMS_SCROLL_TOLERANCE_PX = 8

export type ScrollMetrics = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/** 最後まで読んだ（または読む量がスクロール不要）か。 */
export function hasReadTerms(metrics: ScrollMetrics): boolean {
  const noScrollNeeded = metrics.scrollHeight <= metrics.clientHeight + TERMS_SCROLL_TOLERANCE_PX
  const reachedBottom = metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - TERMS_SCROLL_TOLERANCE_PX
  return noScrollNeeded || reachedBottom
}

export function canSubmitTerms(readToEnd: boolean, checked: boolean): boolean {
  return readToEnd && checked
}

/** いまの版に同意済みなら手順2から始める。 */
export function initialWizardStep(agreedVersion: string | null): number {
  return agreedVersion === TERMS_DOCUMENT.version ? STEP.BASICS : STEP.TERMS
}

/**
 * 同意した日時（D1 の datetime('now')＝UTC の「YYYY-MM-DD HH:MM:SS」）を日本時間の「10/2 23:41」にする。
 * 今の画面は日付だけを、端末の時刻として読んでいた（9時間ずれる日があった）。
 */
export function formatAgreedAt(value: string | null): string | null {
  if (!value) return null
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value.replace(' ', 'T') : `${value.replace(' ', 'T')}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const map = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]))
  return `${map.month}/${map.day} ${map.hour.padStart(2, '0')}:${map.minute.padStart(2, '0')}`
}
