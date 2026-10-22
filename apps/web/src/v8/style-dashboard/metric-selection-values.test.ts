import { expect, it } from 'vitest'
import type { StyleSnapshot } from '@line-crm/shared'
import { metricOptions, selectedKpis } from './metric-selection'
import { kpisFor } from './adapter'
const snapshot: StyleSnapshot = { style: 'salon', from: '2026-10-20T15:00:00Z', to: '2026-10-21T15:00:00Z', timeZone: 'Asia/Tokyo', asOf: '2026-10-21T05:00:00Z', dateBasis: 'visit', range: 'today', metrics: { bookings: { value: 4, status: 'available', unit: '件', formula: '実予約' }, visits: { value: 0, status: 'available', unit: '人', formula: '来店の印' }, noShowRate: { value: null, status: 'insufficient_sample', unit: '%', formula: '無断/予約', denominator: 0 } }, previous: {}, items: [], newBookings: [], resultId: 'real' }
it('明示された順序と空配列を保ち、0・欠測・標本不足を混ぜない', () => {
  const chosen = selectedKpis('salon', snapshot, 'today', ['visits', 'pendingCount', 'noShowRate', 'bookings'])
  expect(chosen.map(kpi => [kpi.metricId, kpi.value])).toEqual([['visits', 0], ['pendingCount', null], ['noShowRate', null], ['bookings', 4]])
  expect(chosen[0]).toMatchObject({ unit: '人', help: '来店の印' })
  expect(chosen[1].detail).toBe('まだ取得できていません')
  expect(chosen[2].detail).toBe('数が少ないため出せません')
  expect(selectedKpis('salon', snapshot, 'today', [])).toEqual([])
})
it('既存カタログだけを候補にし、APIにない指名率を作らない', () => {
  const choices = metricOptions(kpisFor('salon', snapshot, 'today'), 'salon')
  expect(choices.some(item => item.id === 'designationRate')).toBe(false)
  expect(choices.find(item => item.id === 'visits')?.label).toBe('来店数')
  expect(metricOptions([], 'consult').find(item => item.id === 'visits')?.label).toBe('実施数')
})
