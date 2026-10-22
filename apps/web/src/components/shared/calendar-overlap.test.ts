import { describe, expect, it } from 'vitest'
import { groupCalendarIntervals } from './calendar-overlap'

const slot = (value: string, start: number, end: number) => ({ value, start, end })
describe('calendar collision grouping', () => {
  it('keeps empty, individual and touching intervals separate', () => {
    expect(groupCalendarIntervals([])).toEqual([])
    expect(groupCalendarIntervals([slot('first', 600, 660), slot('next', 660, 720)]).map(group => [group.peak, group.entries.map(row => row.value)])).toEqual([[1, ['first']], [1, ['next']]])
  })
  it('reuses a released lane in a transitive chain instead of counting three as simultaneous', () => {
    const [group] = groupCalendarIntervals([slot('third', 660, 720), slot('first', 600, 660), slot('middle', 630, 690)])
    expect(group.peak).toBe(2)
    expect(group.entries.map(entry => [entry.value, entry.lane])).toEqual([['first', 0], ['middle', 1], ['third', 0]])
  })
  it('counts the true peak of nested and identical intervals without losing any IDs', () => {
    const [group] = groupCalendarIntervals([slot('long', 600, 900), slot('short', 610, 650), slot('same', 610, 650), slot('last', 650, 700)])
    expect(group.peak).toBe(3)
    expect(group.entries.map(entry => entry.value)).toEqual(['long', 'short', 'same', 'last'])
    expect(group.entries[3].lane).toBe(1)
  })
})
