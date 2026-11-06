// @vitest-environment happy-dom
/*
 * 108：行の右は「…」に1つ。予約枠の削除は行に直に置かず、
 * 「…」の区切りの下・赤で最後（持ち主 RowActions が決める）。
 * 予約が入っている枠の削除は押せない理由つきで残す。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventSlot } from '@/lib/api'
import { SlotsTab } from './edit-form'

function slot(overrides: Partial<EventSlot>): EventSlot {
  return {
    id: 'slot-1', event_id: 'ev-1',
    starts_at: '2026-11-01T10:00:00+09:00', ends_at: '2026-11-01T11:00:00+09:00',
    capacity: 10, is_active: 1, sort_order: 0, active_count: 0,
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('予約枠の行の右は「…」に1つ (108)', () => {
  it('削除は行に出さず「…」の中に置き、選ぶと確認窓が出る', () => {
    render(<SlotsTab accountId="acc-1" eventId="ev-1" slots={[slot({})]} setSlots={vi.fn()} />)
    const menus = screen.getAllByRole('button', { name: /のその他操作$/ })
    expect(menus).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
    fireEvent.click(menus[0])
    fireEvent.click(screen.getByRole('menuitem', { name: '削除する' }))
    expect(screen.getByText('「この予約枠」を削除しますか？')).toBeTruthy()
  })

  it('予約が入っている枠の削除は理由つきで押せないまま残す', () => {
    render(<SlotsTab accountId="acc-1" eventId="ev-1" slots={[slot({ id: 'slot-2', active_count: 2 })]} setSlots={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /のその他操作$/ }))
    const item = screen.getByRole('menuitem', { name: '削除する' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
    expect(item.getAttribute('aria-description')).toContain('既存予約があるため削除できません')
  })
})
