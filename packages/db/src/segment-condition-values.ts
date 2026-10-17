

export function asString(value: unknown, ruleType: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${ruleType} rule requires a string value`)
  }
  return value
}

export function asStringArray(value: unknown, ruleType: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${ruleType} rule requires an array of string IDs`)
  }
  if (value.length === 0) {
    throw new Error(`${ruleType} rule requires at least one ID`)
  }
  return value as string[]
}

export function asRecord(value: unknown, ruleType: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${ruleType} rule requires an object value`)
  }
  return value as Record<string, unknown>
}

/**
 * 期間の条件。from / to はどちらも省略できるが、両方省略は受け付けない。
 * 「期間を指定したつもりで全員に一致する」事故を防ぐため。
 */
export function buildDateRange(column: string, value: unknown, ruleType: string): { sql: string; bindings: unknown[] } {
  const v = asRecord(value, ruleType)
  const from = typeof v.from === 'string' && v.from !== '' ? v.from : null
  const to = typeof v.to === 'string' && v.to !== '' ? v.to : null
  if (!from && !to) {
    throw new Error(`${ruleType} rule requires at least one of from / to`)
  }
  const parts: string[] = []
  const bindings: unknown[] = []
  if (from) {
    parts.push(`${column} >= ?`)
    bindings.push(from)
  }
  if (to) {
    // 「〜まで」は、その日の終わりまでを含める。日付だけを渡されたときに
    // 当日ぶんが落ちると、指定した本人の期待とずれる。
    parts.push(`${column} <= ?`)
    bindings.push(to.length === 10 ? `${to}T23:59:59.999` : to)
  }
  return { sql: `(${parts.join(' AND ')})`, bindings }
}
