/*
 * ★V7「日付と数の書き方」の正本（設計板 ZzBqa §2）。
 *
 * 管理画面で日付・数を文字にするときはここを通す。`toLocaleString`・
 * `Intl.DateTimeFormat`・`Intl.NumberFormat` を画面側で直接呼ばない。
 *
 * - 時刻帯は日本時間（JST = UTC+9、夏時間なし）に固定。
 *   PCの時計の地域に左右されない。予約のように「店舗の時間帯」が
 *   意味を持つ画面だけ、timeZone を明示して店舗時間帯で出せる。
 * - 秒は出さない。曜日は日付と一緒の時だけ。
 * - CSVなどの読み出しは実務向けに ISO のまま（ここを通さない）。
 *
 *   日時（今年）   9月30日（火）0:48      表・詳細・ふきだし
 *   日時（別の年） 2025年4月3日 10:00    年が違うときだけ年を付ける
 *   近い時刻       3分前・昨日 18:02     一覧の「最新やりとり」。7日より前は日付
 *   日付だけ       10月4日（土）          予約日・期限
 *   期間           9月1日〜9月30日        両側とも月日を書く
 *   件数・人数     12,480人・3件          0は「0件」と書く
 *   大きな数       1.2万                  1万2千以上。数のカード・グラフ目盛りだけ
 *   割合           48.2%                  小数1桁。差は pt（先月より -1.1pt）
 *   お金           ¥12,400
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
  const date = value instanceof Date ? value : new Date(value)
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

/** M月D日（曜）H:mm。年が違うときだけ `YYYY年M月D日 H:mm`（曜日なし）。店舗時間帯で出す画面だけ timeZone を渡す。 */
export function formatDateTime(
  value: DateInput, fallback = '—', now?: DateInput, timeZone = 'Asia/Tokyo',
): string {
  const p = toParts(value, timeZone)
  if (!p) return fallback
  if (p.y !== (toParts(now ?? new Date(), timeZone) ?? nowJst()).y) {
    return `${p.y}年${p.m}月${p.d}日 ${p.h}:${pad2(p.min)}`
  }
  return `${p.m}月${p.d}日${weekday(p.w)}${p.h}:${pad2(p.min)}`
}

/** M月D日（曜）。予約日・期限など時刻を出さない日付。年が違う記録は `YYYY年M月D日`。店舗時間帯で出す画面だけ timeZone を渡す。 */
export function formatDay(value: DateInput, fallback = '—', now?: DateInput, timeZone = 'Asia/Tokyo'): string {
  const p = toParts(value, timeZone)
  if (!p) return fallback
  if (p.y !== (toParts(now ?? new Date(), timeZone) ?? nowJst()).y) return `${p.y}年${p.m}月${p.d}日`
  return `${p.m}月${p.d}日${weekday(p.w)}`
}

/** YYYY-MM-DD（日本時間）。ファイル名・送信値など機械が読む形。表示には使わない。 */
export function formatYmd(value: DateInput, fallback = ''): string {
  const p = toJst(value)
  if (!p) return fallback
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
}

/** H:mm だけ（秒なし）。店舗時間帯で出す画面だけ timeZone を渡す。 */
export function formatTime(value: DateInput, fallback = '—', timeZone = 'Asia/Tokyo'): string {
  const p = toParts(value, timeZone)
  if (!p) return fallback
  return `${p.h}:${pad2(p.min)}`
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

/** 3桁カンマ＋単位（12,480人・3件）。0は「0件」と書く。 */
export function formatCount(value: number | null | undefined, unit: string, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return `${commaFmt.format(value)}${unit}`
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
