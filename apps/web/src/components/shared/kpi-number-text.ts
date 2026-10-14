/** B-195: 数字・金額・割合・時間だけ。状態や名称は札へ。 */
export function isKpiNumberText(text: string): boolean {
  if (text.trim() === '—') return true
  const parts = text.trim().split(/\s*→\s*/u)
  if (parts.length > 2) return false
  return parts.every(part => /^[+−\-¥￥$€£]?\s*\d[\d,.:/\s%％+−\-¥￥$€£]*?(?:(?:B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|kg|g|mile|人|名|件|通目|通|組|回|円|枠|席|社|個|枚|マス|時間|分|秒|日|月|年)[\d,.:/\s]*)*$/.test(part))
}
