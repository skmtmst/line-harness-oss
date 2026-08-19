/*
 * 日付の差し込み。
 *
 * Lステップの「配信日」と「その他（目標日までの日数）」にあたる。
 *
 * これが無いと、「◯月◯日から始まります」と書くために、配信のたびに本文を
 * 書き換えることになる。カウントダウンは「あと3日です」を毎日書き換える
 * ことになり、書き換え忘れると嘘の日数が届く。
 *
 * **すべて日本時間で数える。** 配信は JST で動いていて、読む人も日本にいる。
 * 端末や実行環境の時計に合わせると、深夜の配信で日付が1日ずれる。
 */

/** 書き方。Lステップが出している8通りに合わせてある。 */
export type DateFormat =
  | 'md_w'
  | 'ymd_w'
  | 'md'
  | 'ymd'
  | 'slash_md_w'
  | 'slash_ymd_w'
  | 'slash_md'
  | 'slash_ymd'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export const DATE_FORMATS: { value: DateFormat; label: string; example: string }[] = [
  { value: 'md_w', label: '月日と曜日', example: '8月20日(水)' },
  { value: 'ymd_w', label: '年月日と曜日', example: '2026年8月20日(水)' },
  { value: 'md', label: '月日', example: '8月20日' },
  { value: 'ymd', label: '年月日', example: '2026年8月20日' },
  { value: 'slash_md_w', label: '月日と曜日（スラッシュ）', example: '8/20(水)' },
  { value: 'slash_ymd_w', label: '年月日と曜日（スラッシュ）', example: '2026/8/20(水)' },
  { value: 'slash_md', label: '月日（スラッシュ）', example: '8/20' },
  { value: 'slash_ymd', label: '年月日（スラッシュ）', example: '2026/8/20' },
]

const FORMAT_NAMES = new Set(DATE_FORMATS.map((f) => f.value))

function isDateFormat(value: string): value is DateFormat {
  return FORMAT_NAMES.has(value as DateFormat)
}

/** JST での年月日を取り出す。 */
function jstParts(date: Date): { y: number; m: number; d: number; w: number } {
  const jst = new Date(date.getTime() + 9 * 60 * 60_000)
  return {
    y: jst.getUTCFullYear(),
    m: jst.getUTCMonth() + 1,
    d: jst.getUTCDate(),
    w: jst.getUTCDay(),
  }
}

export function formatDate(date: Date, format: DateFormat): string {
  const { y, m, d, w } = jstParts(date)
  const wd = WEEKDAYS[w]
  switch (format) {
    case 'md_w':
      return `${m}月${d}日(${wd})`
    case 'ymd_w':
      return `${y}年${m}月${d}日(${wd})`
    case 'md':
      return `${m}月${d}日`
    case 'ymd':
      return `${y}年${m}月${d}日`
    case 'slash_md_w':
      return `${m}/${d}(${wd})`
    case 'slash_ymd_w':
      return `${y}/${m}/${d}(${wd})`
    case 'slash_md':
      return `${m}/${d}`
    case 'slash_ymd':
      return `${y}/${m}/${d}`
  }
}

/**
 * 目標日までの日数。
 *
 * **日付だけで数える。** 時刻まで見ると、同じ「明日」でも朝と夜で
 * 0日と1日に割れる。読む人が数えるのは寝る回数なので、日付で切る。
 *
 * 過ぎていれば 0。「あと-3日」と書かれるより、書いた人が気づくほうがよい
 * ……とはいえ配信を止めるほどではないので、0 にして進める。
 */
export function daysUntil(from: Date, targetYmd: string): number | null {
  const m = targetYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const f = jstParts(from)
  const base = Date.UTC(f.y, f.m - 1, f.d)
  const diff = Math.round((target - base) / 86_400_000)
  return diff > 0 ? diff : 0
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/**
 * 本文の日付の差し込みを置き換える。
 *
 *   {{date}}                … 配信日（月日と曜日）
 *   {{date:ymd}}            … 書き方を指定
 *   {{date+3}}              … 配信日から3日後
 *   {{date+3:slash_md}}     … 3日後を指定の書き方で
 *   {{days_until:2026-12-25}} … その日までの残り日数
 *
 * 知らない書き方が指定されたら、既定（月日と曜日）で出す。差し込みごと
 * 本文に残すと、そのまま相手に `{{date:xxx}}` が届く。
 */
export function expandDateVariables(content: string, deliveredAt: Date): string {
  let out = content

  out = out.replace(/\{\{date([+-]\d+)?(?::([a-z_]+))?\}\}/g, (_m, offset: string | undefined, format: string | undefined) => {
    const days = offset ? Number(offset) : 0
    const fmt = format && isDateFormat(format) ? format : 'md_w'
    return formatDate(addDays(deliveredAt, Number.isFinite(days) ? days : 0), fmt)
  })

  out = out.replace(/\{\{days_until:(\d{4}-\d{2}-\d{2})\}\}/g, (_m, ymd: string) => {
    const n = daysUntil(deliveredAt, ymd)
    return n === null ? '' : String(n)
  })

  return out
}
