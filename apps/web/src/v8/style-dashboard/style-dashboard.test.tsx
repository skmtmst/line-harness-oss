import { describe, expect, it } from 'vitest'
import { STYLE_CONFIG, rangeFromParam, tabFromParam, viewFromParam } from './config'
import { rowMenuItems } from './parts'
import { restaurantRow } from './restaurant-today'
import { analyticsWindow, metricDelta, metricValue } from './adapter'
import type { RestaurantReservation } from '@/lib/restaurant-test-api'

const noop = { open: () => {}, visit: () => {}, line: () => {}, pay: () => {}, copy: () => {}, roster: () => {} }

describe('業種ダッシュボード（XBkC2）', () => {
  it('題は業種の名前、1枚目のタブは業種ごとの名前', () => {
    expect(STYLE_CONFIG.restaurant.title).toBe('お店')
    expect(STYLE_CONFIG.salon.title).toBe('サロン')
    expect(Object.values(STYLE_CONFIG.restaurant.tabs)).toEqual(['席', '予約', 'お客さま', '分析'])
    expect(Object.values(STYLE_CONFIG.salon.tabs)).toEqual(['台帳', '予約', 'お客さま', '分析'])
    expect(Object.values(STYLE_CONFIG.consult.tabs)).toEqual(['面談', '結果待ち', '相談者', '分析'])
    expect(Object.values(STYLE_CONFIG.lesson.tabs)).toEqual(['クラス', '会員', '体験', '分析'])
  })

  it('URL の ?tab= ?view= ?range= は知らない値なら初期に戻す', () => {
    expect(tabFromParam('analytics')).toBe('analytics')
    expect(tabFromParam('なにか')).toBe('main')
    expect(viewFromParam('salon', 'floor')).toBe('board')
    expect(viewFromParam('restaurant', 'floor')).toBe('floor')
    expect(viewFromParam('restaurant', null)).toBe('list')
    expect(rangeFromParam('month')).toBe('month')
    expect(rangeFromParam('year')).toBe('today')
  })

  it('閲覧のみの行の「…」は「詳細を開く」だけ（押せない操作を置かない）', () => {
    for (const style of ['restaurant', 'salon', 'consult'] as const) {
      expect(rowMenuItems(style, { id: 'r', time: '10:00', name: 'A' }, false, noop).map((i) => i.id)).toEqual(['detail'])
    }
  })

  it('決済の操作は押せる形で置き、押すと決済の案内へ渡す（押せないボタンを置かない）', () => {
    let paid = ''
    const items = rowMenuItems('restaurant', { id: 'r', time: '10:00', name: 'A' }, true, { ...noop, pay: (row) => { paid = row.id } })
    const pay = items.find((i) => i.id === 'pay-link')
    expect(pay?.disabled).toBeFalsy()
    pay?.onSelect?.()
    expect(paid).toBe('r')
    expect(items.at(-1)?.tone).toBe('danger')
  })

  it('飲食の口が無いときの行：来店できる予約は［来店］、来店済みは［取り消す］', () => {
    const base = { id: 'x', store_id: 's', store_name: '店', source: 'line', external_id: null, customer_name: '佐藤', customer_phone: null, line_uid: null, guest_count: 2, starts_at: '2026-10-15T09:00:00.000Z', ends_at: '2026-10-15T10:30:00.000Z', table_id: null, table_label: 'T3', course_id: null, course_name: null, status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' } as RestaurantReservation
    expect(restaurantRow(base)).toMatchObject({ reservationId: 'x', seat: 'T3', course: '席のみ', action: 'visit' })
    expect(restaurantRow({ ...base, status: 'visited' }).action).toBe('undo')
  })

  it('口の数：率は %、取れない数は「—」と理由（0 にしない）、無断率は下がると緑', () => {
    expect(metricValue({ value: 0.384, numerator: 46, denominator: 120, status: 'available', formula: '', unit: '' })).toMatchObject({ value: 38.4, unit: '%' })
    expect(metricValue({ value: null, status: 'insufficient_sample', formula: '', unit: '' })).toMatchObject({ value: null, reason: '数が少ないため出せません' })
    expect(metricValue({ value: 0, status: 'available', formula: '', unit: '件' })).toMatchObject({ value: 0 })
    const now = { value: 0.012, numerator: 3, denominator: 246, status: 'available' as const, formula: '', unit: '' }
    const prev = { ...now, value: 0.018 }
    expect(metricDelta(now, prev, true)).toEqual({ text: '−0.6pt', tone: 'up' })
    expect(metricDelta(now, { ...prev, value: null, status: 'unconfigured' })).toBeNull()
  })

  it('分析の 30日は選んだ日を最後の日にした [from, to)', () => {
    expect(analyticsWindow('2026-10-15', 30)).toEqual({ from: '2026-09-16', to: '2026-10-16' })
  })
})
