/**
 * 実行結果のCSV書き出しで使う1マスの整形。
 *
 * 表計算ソフトで式として動かないよう、先頭が `= + - @` タブのときは
 * `'` を付けて無効化する。表示名・経路名は友だちや運用者が決める文字列のため。
 */
export function csvCell(value: string): string {
  const escaped = value.replaceAll('"', '""')
  const guarded = /^[=+\-@\t]/.test(escaped) ? `'${escaped}` : escaped
  return `"${guarded}"`
}
