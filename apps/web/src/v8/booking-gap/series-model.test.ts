import { expect, test } from 'vitest'
import type { SeriesOccurrence } from '@/lib/api/helpers/gap2'
import { createdCount, dayWithWeekday, hm, initialPick, ruleLabel } from './series-model'

const occ = (index: number, available: boolean, alternatives: string[] = []): SeriesOccurrence => ({ index, startsAt: '2026-11-20T05:00:00.000Z', available, alternatives })

test('取れない回の初めの扱い：近い時間があれば別の時間、無ければ飛ばす（黙って作らない）', () => {
  expect(initialPick(occ(0, true))).toBe('keep')
  expect(initialPick(occ(1, false, ['2026-11-20T07:00:00.000Z']))).toBe('alternative')
  expect(initialPick(occ(2, false))).toBe('skip')
})

test('作る件数は取れた回＋別の時間にした回。飛ばす回と、近い時間が無いのに別の時間を選んだ回は数えない', () => {
  const list = [occ(0, true), occ(1, false, ['x']), occ(2, false), occ(3, true)]
  expect(createdCount(list, { 1: 'alternative', 2: 'skip' })).toBe(3)
  expect(createdCount(list, { 1: 'skip', 2: 'alternative' })).toBe(2)
})

test('日本時間で言葉にする（毎週金曜 14:00・隔週・毎月第 3 金曜）', () => {
  expect(dayWithWeekday('2026-11-20T05:00:00.000Z')).toBe('11/20（金）')
  expect(hm('2026-11-20T05:00:00.000Z')).toBe('14:00')
  expect(ruleLabel('weekly', '2026-11-20T05:00:00.000Z')).toBe('毎週金曜 14:00')
  expect(ruleLabel('biweekly', '2026-11-20T05:00:00.000Z')).toBe('隔週金曜 14:00')
  expect(ruleLabel('monthly_nth', '2026-11-20T05:00:00.000Z')).toBe('毎月第 3 金曜 14:00')
})


test('店舗の日付・第N曜日で繰り返し、日本と日付が違う店でも翌日に移さない', () => {
  const at = '2026-11-04T23:00:00.000Z', zone = 'America/New_York'
  expect(dayWithWeekday(at, zone)).toBe('11/04（水）')
  expect(ruleLabel('monthly_nth', at, zone)).toBe('毎月第 1 水曜 18:00')
  expect(hm('2026-07-01T22:00:00Z', zone)).toBe('18:00')
  expect(hm('2026-11-05T05:00:00Z', zone)).toBe('00:00')
})
