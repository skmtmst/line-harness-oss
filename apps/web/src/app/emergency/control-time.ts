export function formatMonthDay(value: string | null): string {
  if (!value) return '日時不明'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '日時不明'
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`
}

export function stopMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const diff = Math.round((Date.parse(end) - Date.parse(start)) / 60_000)
  return Number.isFinite(diff) && diff >= 0 ? diff : null
}
