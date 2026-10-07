/*
 * ★V8 Googleビジネスの表示の道具（今の画面 app/restaurant-test/google/google-format.ts から写した）。
 * src/v8 からは @/app を読めないので、使う分だけ写す。日時は店舗の時刻（日本時間）で出す。
 */
import type { GoogleHoursPeriod, GoogleWeekday } from '@/lib/restaurant-google-api'
import { japaneseDetailOf } from '@/components/shared/api-error-message'

export const STORE_TIME_ZONE = 'Asia/Tokyo'
export const WEEKDAYS: GoogleWeekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
export const WEEKDAY_JA: Record<GoogleWeekday, string> = { MONDAY: '月', TUESDAY: '火', WEDNESDAY: '水', THURSDAY: '木', FRIDAY: '金', SATURDAY: '土', SUNDAY: '日' }

function parts(value: string | null | undefined, timeZone = STORE_TIME_ZONE) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const map = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]))
  return { y: map.year, m: Number(map.month), d: Number(map.day), hh: map.hour.padStart(2, '0'), mm: map.minute.padStart(2, '0') }
}

/** 「9/30 21:40」（口コミの受信・投稿の公開）。 */
export function formatShortStamp(value: string | null | undefined): string {
  const p = parts(value)
  return p ? `${p.m}/${p.d} ${p.hh}:${p.mm}` : '—'
}

/** 「9/30」。 */
export function formatShortDay(value: string | null | undefined): string {
  const p = parts(value)
  return p ? `${p.m}/${p.d}` : '—'
}

/** 「2026/09/12」。 */
export function formatYmd(value: string | null | undefined): string {
  const p = parts(value)
  return p ? `${p.y}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}` : '—'
}

/** 「2026/09/12 10:20」。 */
export function formatStampFull(value: string | null | undefined): string {
  const p = parts(value)
  return p ? `${p.y}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')} ${p.hh}:${p.mm}` : '—'
}

/**
 * 口コミの「受信」日時。Googleは口コミが編集されても createTime を変えず updateTime だけを
 * 更新するので、新しい方を使う（今の画面と同じ）。
 */
export function reviewReceivedAt(review: { createTime?: string | null; updateTime?: string | null }): string | null {
  const created = review.createTime ?? null
  const updated = review.updateTime ?? null
  const createdAt = created ? new Date(created).getTime() : Number.NaN
  const updatedAt = updated ? new Date(updated).getTime() : Number.NaN
  if (Number.isNaN(updatedAt)) return created
  if (Number.isNaN(createdAt)) return updated
  return updatedAt > createdAt ? updated : created
}

export function errorMessage(error: unknown, fallback: string): string {
  // 「API error: 500」のような内部の文は出さない。日本語の案内だけを出す。
  return japaneseDetailOf(error) || fallback
}

/** "YYYY-MM-DD" → 曜日。 */
export function weekdayOf(date: string): GoogleWeekday {
  const [y, m, d] = date.split('-').map((x) => Number.parseInt(x, 10))
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return WEEKDAYS[(dow + 6) % 7]
}

/** "2026-10-02" → "10/2（金）" */
export function formatYmdShort(date: string): string {
  const [, m, d] = date.split('-').map((x) => Number.parseInt(x, 10))
  return `${m}/${d}（${WEEKDAY_JA[weekdayOf(date)]}）`
}

/** 営業時間「17:00〜23:00」。 */
export function formatPeriods(periods: GoogleHoursPeriod[], closedLabel = '休業'): string {
  if (!periods.length) return closedLabel
  return periods.map((p) => `${p.open}〜${p.close === '00:00' ? '24:00' : p.close}`).join(' / ')
}

/** 毎週の営業時間を「月–金 17:00〜23:00、火 定休日」の形に縮める。 */
export function summarizeWeekly(weekly: Record<GoogleWeekday, GoogleHoursPeriod[]>): string {
  const groups: Array<{ days: GoogleWeekday[]; text: string }> = []
  for (const day of WEEKDAYS) {
    const text = formatPeriods(weekly[day] ?? [], '定休日')
    const last = groups[groups.length - 1]
    if (last && last.text === text) last.days.push(day)
    else groups.push({ days: [day], text })
  }
  return groups
    .map((g) => `${g.days.length > 2 ? `${WEEKDAY_JA[g.days[0]]}–${WEEKDAY_JA[g.days[g.days.length - 1]]}` : g.days.map((d) => WEEKDAY_JA[d]).join('・')} ${g.text}`)
    .join('、')
}

/** 15分刻みの時刻（00:00〜23:45）。 */
export const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
