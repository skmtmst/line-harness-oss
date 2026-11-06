export type CalendarTimeInterval = { start: string; end: string }
export function calendarMinutes(time: string): number | null {
  if (time === '24:00') return 1440
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
export function calendarInterval(slot: CalendarTimeInterval) {
  const start = calendarMinutes(slot.start), end = calendarMinutes(slot.end)
  return start !== null && end !== null && start < 1440 && end > start ? { start, end } : null
}
/** Retain the default working day and extend to every valid, already day-clipped interval. */
export function calendarTimeRange(slots: readonly CalendarTimeInterval[]) {
  let from = 10, to = 20
  for (const slot of slots) {
    const interval = calendarInterval(slot)
    if (!interval) continue
    from = Math.min(from, Math.floor(interval.start / 60))
    to = Math.max(to, Math.ceil(interval.end / 60))
  }
  return { from, to }
}
