/**
 * CSVの式注入を防ぎ、改行・カンマ・引用符があっても1セルに保つ。
 *
 * 先頭が `= + - @` やタブの文字列は表計算ソフトが式として実行し得るので、
 * `'` を付けて無効化する（OWASP CSV Injection。`=cmd|'/C1 calc'!A0` 系）。
 * サーバ生成CSVは packages/db の protectCsvCell が同じ方針で守る。
 */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** APIの日時を管理画面で使うJST表記へそろえる。 */
export function formatJstDateTime(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** datetime-localへ入れられる端末時刻へ変換する。 */
export function localDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/** datetime-localの入力をAPIへ送るUTC日時へ変換する。 */
export function utcDateTime(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
