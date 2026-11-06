export type CalendarInterval<T> = { start: number; end: number; value: T }
export type CalendarIntervalGroup<T> = {
  start: number
  end: number
  peak: number
  entries: Array<CalendarInterval<T> & { lane: number }>
}

/** Half-open intervals: an ending reservation releases its lane before the next starts. */
export function groupCalendarIntervals<T>(intervals: CalendarInterval<T>[]): CalendarIntervalGroup<T>[] {
  const sorted = intervals.map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.order - b.order)
  const groups: CalendarIntervalGroup<T>[] = []
  let laneEnds: number[] = []
  for (const entry of sorted) {
    let group = groups[groups.length - 1]
    if (!group || entry.start >= group.end) {
      group = { start: entry.start, end: entry.end, peak: 0, entries: [] }
      groups.push(group)
      laneEnds = []
    }
    const available = laneEnds.findIndex(end => end <= entry.start)
    const lane = available < 0 ? laneEnds.length : available
    laneEnds[lane] = entry.end
    group.end = Math.max(group.end, entry.end)
    group.peak = Math.max(group.peak, laneEnds.filter(end => end > entry.start).length)
    group.entries.push({ start: entry.start, end: entry.end, value: entry.value, lane })
  }
  return groups
}
