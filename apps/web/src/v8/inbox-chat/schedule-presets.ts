/*
 * ★V8「予約して送る」（M0393 段2「6. 予約して送る」）の「すぐ選ぶ」。
 * 入力欄は日本時間の datetime-local（YYYY-MM-DDTHH:mm）の約束（INBOX-21）なので、
 * 端末の時間帯ではなく日本時間で数える。
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, '0')

/** 日本時間の年・月・日・時・分を、UTC の器に入れた Date で返す（getUTC* で読む）。 */
function jstClock(now: Date): Date {
  return new Date(now.getTime() + JST_OFFSET_MS)
}

/** 日本時間の暦の上の日時（器は UTC）を datetime-local の文字にする。 */
function toLocal(clock: Date): string {
  return `${clock.getUTCFullYear()}-${pad(clock.getUTCMonth() + 1)}-${pad(clock.getUTCDate())}T${pad(clock.getUTCHours())}:${pad(clock.getUTCMinutes())}`
}

function at(clock: Date, addDays: number, hour: number, minute = 0): string {
  return toLocal(new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate() + addDays, hour, minute)))
}

export type SchedulePreset = { key: string; label: string; value: string }

/** 明日 9:00・明日 13:00・月曜 10:00・営業開始（10:00）・1時間後。 */
export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
  const clock = jstClock(now)
  const dow = clock.getUTCDay() // 0=日 … 1=月
  const toMonday = ((8 - dow) % 7) || 7
  const opening = clock.getUTCHours() < 10 ? 0 : 1
  const inHour = new Date(clock.getTime() + 60 * 60 * 1000)
  return [
    { key: 'tomorrow-9', label: '明日 9:00', value: at(clock, 1, 9) },
    { key: 'tomorrow-13', label: '明日 13:00', value: at(clock, 1, 13) },
    { key: 'monday-10', label: '月曜 10:00', value: at(clock, toMonday, 10) },
    { key: 'opening', label: '営業開始（10:00）', value: at(clock, opening, 10) },
    { key: 'in-hour', label: '1時間後', value: toLocal(inHour) },
  ]
}

/** 相手が夜中（22時〜8時）になる日時か。日本時間の文字から読む。 */
export function isNightJst(local: string): boolean {
  const match = /T(\d{2}):/.exec(local)
  if (!match) return false
  const hour = Number(match[1])
  return hour >= 22 || hour < 8
}

/** ボタンに出す短い日時（10/2 9:00）。 */
export function shortJst(local: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!match) return ''
  return `${Number(match[1])}/${Number(match[2])} ${Number(match[3])}:${match[4]}`
}
