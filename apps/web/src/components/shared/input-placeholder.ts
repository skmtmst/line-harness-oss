/** 見本の明示と、メール・URL・電話などの例だけに「例：」をそろえる。操作の案内文は保つ。 */
export function inputPlaceholder(value: string | undefined): string | undefined {
  if (!value) return value
  if (/^例(?:[:：）)]|\s)/.test(value)) return value.replace(/^例(?:[:：）)]|\s)\s*/, '例：')
  return /^(?:https?:\/\/|[\w.+-]+@[\w.-]+\.|\d[\d -]{5,}\d$)/.test(value) ? `例：${value}` : value
}
