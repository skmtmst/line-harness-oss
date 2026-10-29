export type Hm = { hours: number; minutes: number }

export type TimeInputResult =
  | { kind: 'empty' }
  | { kind: 'ok'; time: Hm; note: string | null }
  | { kind: 'error'; message: string }

/**
 * 打った字を `HH:mm` に直す。
 * - `0900`・`900`・`9:00`・`9：00`・`9`・`09`・`9時`・`9時30分`・全角数字を読む
 * - 時が 24 以上・分が 60 以上は直さず理由を返す
 * - きざみに合わない分は近い方へ合わせ、知らせる文を付ける
 */
export function normalizeTimeInput(raw: string, minuteStep = 1, allowEndOfDay = false): TimeInputResult {
  const text = raw.normalize('NFKC').replace(/\s+/g, '')
  if (text === '' || text === '--:--') return { kind: 'empty' }
  let hours: number
  let minutes: number
  const separated = /^(\d{1,2})(?::|時)(\d{1,2})?分?$/.exec(text)
  const digits = /^\d{1,4}$/.exec(text)
  if (separated) {
    hours = Number(separated[1])
    minutes = separated[2] === undefined ? 0 : Number(separated[2])
  } else if (digits) {
    if (text.length <= 2) {
      hours = Number(text)
      minutes = 0
    } else {
      hours = Number(text.slice(0, text.length - 2))
      minutes = Number(text.slice(-2))
    }
  } else {
    return { kind: 'error', message: '「0900」「9:00」の形で入れてください' }
  }
  if (allowEndOfDay && hours === 24 && minutes === 0) return { kind: 'ok', time: { hours, minutes }, note: null }
  if (hours > 23) return { kind: 'error', message: '時は 0〜23 で入れてください' }
  if (minutes > 59) return { kind: 'error', message: '分は 0〜59 で入れてください' }
  const snapped = snapToStep({ hours, minutes }, normalizeStep(minuteStep))
  return {
    kind: 'ok',
    time: snapped.time,
    note: snapped.changed ? `${normalizeStep(minuteStep)}分きざみなので ${formatValue(snapped.time)} にしました` : null,
  }
}

/** きざみの近い方へ合わせる。23時台で 24:00 になるときは下へ。 */
export function snapToStep(time: Hm, minuteStep: number): { time: Hm; changed: boolean } {
  const step = normalizeStep(minuteStep)
  if (time.minutes % step === 0) return { time, changed: false }
  let total = time.hours * 60 + Math.round(time.minutes / step) * step
  if (total >= 24 * 60) total = time.hours * 60 + Math.floor(time.minutes / step) * step
  return { time: { hours: Math.floor(total / 60), minutes: total % 60 }, changed: true }
}

/** `HH:mm`（秒付きも可）を読む。読めなければ null。 */
export function parseHm(value: string, allowEndOfDay = false): Hm | null {
  const match = /^(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (allowEndOfDay && hours === 24 && minutes === 0) return { hours, minutes }
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

/** 60 を割り切る 1〜60 の整数だけ受ける。それ以外は 1。 */
export function normalizeStep(step: number): number {
  return Number.isInteger(step) && step >= 1 && step <= 60 && 60 % step === 0 ? step : 1
}

/** 分の列。きざみに合わない今の値があれば、その値も並べて選んだ形で見せる。 */
export function minuteOptions(step: number, currentMinute?: number): number[] {
  const list = Array.from({ length: 60 / step }, (_, index) => index * step)
  if (currentMinute !== undefined && !list.includes(currentMinute)) {
    list.push(currentMinute)
    list.sort((a, b) => a - b)
  }
  return list
}

export function nowInTokyo(): Hm {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const hours = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return { hours: hours % 24, minutes }
}

export function formatValue(time: Hm): string {
  return `${formatTimePart(time.hours)}:${formatTimePart(time.minutes)}`
}

/** 欄に見せる字。絵の「09 : 00」。 */
export function formatShown(time: Hm): string {
  return `${formatTimePart(time.hours)} : ${formatTimePart(time.minutes)}`
}

export function formatTimePart(n: number): string {
  return String(n).padStart(2, '0')
}
