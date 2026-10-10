/*
 * B-152（2026-10-09）：管理画面の日付と数は、この共通書式を使う。
 * 一覧は MM/DD HH:mm、過去の別年は YYYY/MM/DD。
 * 詳細は M月D日（曜）HH:mm。店舗の時間帯は指定して保つ。
 * 件数は3桁区切りと単位の前の半角空き、金額は ¥29,800、割合は12.4%。
 * 保存値・CSV・日付入力の機械向け書式は表示の書式と分ける。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

type DateInput = string | number | Date | null | undefined

interface JstParts {
  y: number
  m: number
  d: number
  w: number
  h: number
  min: number
  epoch: number
}

function jstParts(epoch: number): JstParts {
  const j = new Date(epoch + JST_OFFSET_MS)
  return {
    y: j.getUTCFullYear(),
    m: j.getUTCMonth() + 1,
    d: j.getUTCDate(),
    w: j.getUTCDay(),
    h: j.getUTCHours(),
    min: j.getUTCMinutes(),
    epoch,
  }
}

/*
 * 店舗の時間帯など JST 以外を明示されたときの部品。timeZone を固定して渡すので
 * 端末の地域には依存しない（#651: 非JST店舗の予約を店舗時間帯で表示する）。
 */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()
function zonedParts(date: Date, epoch: number, timeZone: string): JstParts | null {
  let fmt = zoneFormatters.get(timeZone)
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('ja-JP', {
        timeZone,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
      })
    } catch {
      return null
    }
    zoneFormatters.set(timeZone, fmt)
  }
  const got: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) got[part.type] = part.value
  const w = WEEKDAYS.indexOf(got.weekday as (typeof WEEKDAYS)[number])
  const y = Number(got.year)
  const m = Number(got.month)
  const d = Number(got.day)
  const h = Number(got.hour) % 24
  const min = Number(got.minute)
  if (![y, m, d, h, min].every(Number.isFinite) || w < 0) return null
  return { y, m, d, w, h, min, epoch }
}

function toParts(value: DateInput, timeZone = 'Asia/Tokyo'): JstParts | null {
  if (value === null || value === undefined || value === '') return null
  // SQLite の時刻（オフセットなし）は UTC。端末の地域に左右されない。
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) && !/Z$|[+-]\d{2}:?\d{2}$/i.test(value) ? `${value.replace(' ', 'T')}Z` : value
  const date = normalized instanceof Date ? normalized : new Date(normalized)
  const epoch = date.getTime()
  if (Number.isNaN(epoch)) return null
  if (timeZone === 'Asia/Tokyo') return jstParts(epoch)
  return zonedParts(date, epoch, timeZone)
}

function toJst(value: DateInput): JstParts | null {
  return toParts(value)
}

/** いまの日本時間の部品（年比較・◯分前の基準に使う）。 */
function nowJst(now?: DateInput): JstParts {
  return toJst(now ?? new Date()) as JstParts
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const weekday = (w: number) => `（${WEEKDAYS[w]}）`

/** B-152：日付の表示はこの1つの関数で作る。保存値・CSVには使わない。 */
export function formatDate(
  value: DateInput,
  options: { style?: 'detail' | 'list' | 'list-day' | 'list-day-weekday' | 'day' | 'time'; fallback?: string; now?: DateInput; timeZone?: string } = {},
): string {
  const { style = 'detail', fallback = '—', now, timeZone = 'Asia/Tokyo' } = options
  const p = toParts(value, timeZone)
  if (!p) return fallback
  const clock = `${pad2(p.h)}:${pad2(p.min)}`
  if (style === 'time') return clock
  const currentYear = (toParts(now ?? new Date(), timeZone) ?? nowJst()).y
  const sameYear = p.y === currentYear
  if (style === 'list' || style === 'list-day' || style === 'list-day-weekday') {
    const day = `${pad2(p.m)}/${pad2(p.d)}`
    if (!sameYear) return `${p.y}/${day}${style === 'list-day-weekday' ? weekday(p.w) : style === 'list' && p.y > currentYear ? ` ${clock}` : ''}`
    if (style === 'list-day-weekday') return `${day}${weekday(p.w)}`
    return style === 'list-day' ? day : `${day} ${clock}`
  }
  const day = `${sameYear ? '' : `${p.y}年`}${p.m}月${p.d}日${weekday(p.w)}`
  return style === 'day' ? day : `${day}${clock}`
}

/** 詳細・説明文の日付。 */
export function formatDateTime(value: DateInput, fallback = '—', now?: DateInput, timeZone = 'Asia/Tokyo'): string {
  return formatDate(value, { style: 'detail', fallback, now, timeZone })
}

/** 一覧・表の日付。今年は MM/DD HH:mm、別の年は YYYY/MM/DD。 */
export function formatListDateTime(value: DateInput, fallback = '—', now?: DateInput, timeZone = 'Asia/Tokyo'): string {
  return formatDate(value, { style: 'list', fallback, now, timeZone })
}

/** 時刻を持たない一覧の日付。 */
export function formatListDay(value: DateInput, fallback = '—', now?: DateInput, timeZone = 'Asia/Tokyo'): string {
  return formatDate(value, { style: 'list-day', fallback, now, timeZone })
}

/** M月D日（曜）。予約日・期限など時刻を出さない日付。年が違う記録は `YYYY年M月D日`。店舗時間帯で出す画面だけ timeZone を渡す。 */
export function formatDay(value: DateInput, fallback = '—', now?: DateInput, timeZone = 'Asia/Tokyo'): string {
  return formatDate(value, { style: 'day', fallback, now, timeZone })
}

/** YYYY-MM-DD（日本時間）。ファイル名・送信値など機械が読む形。表示には使わない。 */
export function formatYmd(value: DateInput, fallback = ''): string {
  const p = toJst(value)
  if (!p) return fallback
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
}

/** H:mm だけ（秒なし）。店舗時間帯で出す画面だけ timeZone を渡す。 */
export function formatTime(value: DateInput, fallback = '—', timeZone = 'Asia/Tokyo'): string {
  return formatDate(value, { style: 'time', fallback, timeZone })
}

/**
 * 一覧の「最新やりとり」向けの近い時刻。
 * 1分未満→たった今 / ◯分前 / ◯時間前 / 昨日 H:mm / ◯日前 / 7日より前は日付。
 */
export function formatRelative(value: DateInput, now?: DateInput, fallback = '—'): string {
  const p = toJst(value)
  if (!p) return fallback
  const n = nowJst(now)
  const diffMin = Math.floor((n.epoch - p.epoch) / 60_000)
  if (diffMin < 0) return formatDateTime(value, fallback, now)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`
  // 暦日差で「昨日」を判定し、7日より前は日付へ
  const dayIndex = (e: number) => Math.floor((e + JST_OFFSET_MS) / 86_400_000)
  const dayDiff = dayIndex(n.epoch) - dayIndex(p.epoch)
  if (dayDiff === 0) return `${Math.floor(diffMin / 60)}時間前`
  if (dayDiff === 1) return `昨日 ${p.h}:${pad2(p.min)}`
  if (dayDiff < 7) return `${dayDiff}日前`
  return formatDay(value, fallback)
}

/** M月D日〜M月D日。両側とも月日を書く（9月1日〜9月30日）。年が違う側だけ `YYYY年` を付ける。 */
export function formatRange(from: DateInput, to: DateInput, fallback = '—'): string {
  const a = toJst(from)
  const b = toJst(to)
  if (!a || !b) return fallback
  const y = nowJst().y
  const left = `${a.y === y ? '' : `${a.y}年`}${a.m}月${a.d}日`
  const right = `${b.y === y ? '' : `${b.y}年`}${b.m}月${b.d}日`
  return `${left}〜${right}`
}

const commaFmt = new Intl.NumberFormat('ja-JP')

/** 3桁ごとにカンマ（12,480）。単位は呼び出し側が付ける。digits で小数桁を固定できる。 */
export function formatNumber(
  value: number | null | undefined,
  options?: { fallback?: string; digits?: number },
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return options?.fallback ?? '—'
  if (options?.digits === undefined) return commaFmt.format(value)
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: options.digits,
    maximumFractionDigits: options.digits,
  })
}

/** 3桁カンマ＋半角空き＋単位（12,480 人・3 件）。0は「0 件」と書く。 */
export function formatCount(value: number | null | undefined, unit: string, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return `${commaFmt.format(value)} ${unit}`
}

/**
 * 1万2千以上は△△万（1.2万）。数のカード・グラフの目盛りだけに使う。
 * 表の中の正確な数は formatNumber / formatCount。
 */
export function formatBig(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  if (Math.abs(value) < 12000) return commaFmt.format(value)
  const man = Math.round((value / 10_000) * 10) / 10
  return `${Number.isInteger(man) ? man : man.toFixed(1)}万`
}

/** 小数1桁の割合。呼び出し側は 0〜100 の値を渡す（48.2 → "48.2%"）。 */
export function formatPercent(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return `${value.toFixed(1)}%`
}

/** 割合の差は pt（先月より -1.1pt）。呼び出し側は 0〜100 の差を渡す。 */
export function formatPointDiff(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}pt`
}

/** ¥12,400（半角の¥。Intl の￥は全角なので直結合）。税込みか税抜きかは見出しに書く。 */
export function formatYen(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return `¥${commaFmt.format(Math.round(value))}`
}
