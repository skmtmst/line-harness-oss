export function scheduleStamp(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!match) return value
  const [, m, d, hh, mm] = match
  return `${Number(m)}/${Number(d)}${hh ? ` ${Number(hh)}:${mm}` : ''}`
}

export function changeText(before: string, after: string): string {
  const from = before || '（空）'
  const to = after || '（空）'
  const head = /^(\S+\s)/.exec(from)?.[1]
  return `${from} → ${head && to.startsWith(head) && to.length > head.length ? to.slice(head.length) : to}`
}
