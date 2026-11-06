/** 数の文言に付く単位の正本。下の isKpiNumberText の直書きと中身は同じ。 */
export const KPI_COUNT_UNITS = 'B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|kg|g|mile|人|名|件|通目|通|組|回|円|枠|席|社|個|枚|マス|時間|分|秒|日|月|年'

/** : 数字・金額・割合・時間だけ。状態や名称は札へ。 */
export function isKpiNumberText(text: string): boolean {
  if (text.trim() === '—') return true
  // 版の番号（v3・v2.6.4）は値として数の場所に出す。「—」と札に分けない。
  if (/^v\d+(?:\.\d+)*$/.test(text.trim())) return true
  const parts = text.trim().split(/\s*→\s*/u)
  if (parts.length > 2) return false
  return parts.every(part => /^[+−\-¥￥$€£]?\s*\d[\d,.:/\s%％+−\-¥￥$€£]*?(?:(?:B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|kg|g|mile|人|名|件|通目|通|組|回|円|枠|席|社|個|枚|マス|時間|分|秒|日|月|年)[\d,.:/\s]*)*$/.test(part))
}

/**
 * 14：数の帯の文言が数値ゼロか（0・0件・¥0・0%など）。単位は上の正本に、
 * 0の数え方だけに付く「頭・匹・台・ヶ月・マイル」を足す。日付・状態の言葉と
 * 範囲（〜以上）は対象外。
 */
export function isZeroNumberText(text: string): boolean {
  const stripped = text.replace(/[\s,¥￥%％]/g, '')
  const m = /^[+-]?0+(\.0+)?(.*)$/.exec(stripped)
  if (!m) return false
  const rest = m[2] ?? ''
  return rest === '' || new RegExp(`^(?:${KPI_COUNT_UNITS}|頭|匹|台|ヶ月|マイル)$`).test(rest)
}
