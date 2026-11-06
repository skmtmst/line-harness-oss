/**
 * 一覧の簡易CSV書き出しのセル守り（点検 #496-4）。
 *
 * 正規の書き出し口（`packages/db` の `protectCsvCell`）と同じ約束：
 * 先頭が `=+-@` のセルには `'` を付けて、Excel で数式として動かないようにする。
 * 顧客由来の名前・最新メッセージをそのまま出す口なので、ここが無いと
 * `=cmd|...` 等が開いた PC で意図しない動作になる。
 *
 * 引用符の二重化は従来どおり常に行う（簡易書き出しの既存形式を保つ）。
 */
export function csvExportCell(value: string | null | undefined): string {
  const raw = value ?? ''
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

export function csvExportLine(values: Array<string | null | undefined>): string {
  return values.map((value) => csvExportCell(value)).join(',')
}
