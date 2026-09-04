/**
 * 流入経路の書き出し（設計 `Q4bkTg` の「CSVで書き出す」）。
 *
 * **画面に出ている行をそのまま書き出す。** 絞り込みや並び替えを無視して
 * 全件を出すと、画面と手元のファイルが食い違う。
 */

export type ExportRow = {
  name: string
  ref: string
  /** 未取得は `null`。**0回と混ぜない。** */
  clicks: number | null
  /** 未取得は `null`。**0人と混ぜない。** */
  friendAdds: number | null
  /** 未取得は `null`。**0件と混ぜない。** */
  lastAddedAt: string | null
}

const NOT_AVAILABLE = '—'

/** CSVの1つぶん。区切り・引用符・改行を含む値を壊さない。 */
function cell(value: string | number | null): string {
  if (value === null) return NOT_AVAILABLE
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const EXPORT_HEADER = ['流入元名', 'REF', 'クリック', '友だち追加', '最新の追加'] as const

/**
 * **取れていない値を0にしない。** 0回と「まだ数えていない」は別のこと。
 * 書き出したあとは画面の断り書きが付いてこないので、ここで取り違えると
 * 手元のファイルだけが残って、あとから0と読まれる。
 */
export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_HEADER.join(',')]
  for (const row of rows) {
    lines.push([
      cell(row.name),
      cell(row.ref),
      cell(row.clicks),
      cell(row.friendAdds),
      cell(row.lastAddedAt),
    ].join(','))
  }
  return lines.join('\n')
}

/** 何本を、いつ書き出したかが分かる名前にする。 */
export function exportFileName(count: number, today: string): string {
  return `流入経路_${count}本_${today}.csv`
}
