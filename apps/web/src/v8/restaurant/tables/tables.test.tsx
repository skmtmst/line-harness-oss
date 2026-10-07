// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), createTable: vi.fn(), updateTable: vi.fn(), updateReservation: vi.fn(), saveTableLayout: vi.fn() }))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))

import TablesPage from './tables'
import { pickMoveTarget } from './move'
import { at, reservation, snapshotOf, tables } from '../booking-kit/test-data'

/* T3 に先の予約が2件：1件目は T4 が空いている、2件目は同じ時間の T4・個室A が埋まっている（4名は入る卓が無い）。 */
const upcoming = [
  reservation('r1', { customer_name: '山田 花子', guest_count: 4, starts_at: at(1, 19), ends_at: at(1, 21), table_id: 't3' }),
  reservation('r2', { customer_name: '田中 明子', guest_count: 4, starts_at: at(2, 19), ends_at: at(2, 21), table_id: 't3' }),
  reservation('r3', { customer_name: '別の人', guest_count: 4, starts_at: at(2, 19), ends_at: at(2, 21), table_id: 't4' }),
  reservation('r4', { customer_name: '団体', guest_count: 6, starts_at: at(2, 18), ends_at: at(2, 22), table_id: 'pa' }),
]

beforeEach(() => {
  role.value = 'owner'
  fixture.snapshot.mockResolvedValue({ data: snapshotOf({ reservations: upcoming }) })
  for (const fn of [fixture.createTable, fixture.updateTable, fixture.updateReservation, fixture.saveTableLayout]) fn.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('BERxg 座席・卓管理', () => {
  it('数4・フロアマップ・卓の詳細・自動配席ルールが出て、結合グループに札が付く', async () => {
    render(<TablesPage />)
    await screen.findByText('フロアマップ')
    const board = document.querySelector('[data-design-node="BERxg"]')!
    for (const label of ['卓数', '総席数', '結合可能', '個室', '卓の詳細', '自動配席ルール']) expect(board.textContent).toContain(label)
    expect(screen.getAllByText('結合 A')).toHaveLength(2)
    expect(screen.getByText('T3 · 窓側4人卓')).not.toBeNull()
  })

  it('止めるときは先の予約を出し、入る卓へ移し、入らない予約は未配席にしてから止める', async () => {
    render(<TablesPage />)
    await screen.findByText('フロアマップ')
    fireEvent.click(screen.getByRole('button', { name: 'T3・窓側4人卓を停止' }))
    const dialog = document.querySelector('[data-design-node="eY9F3"]') as HTMLElement
    expect(dialog.textContent).toContain('これから先の予約が 2 件')
    fireEvent.click(within(dialog).getByRole('button', { name: '予約を移して止める' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 't3', { isActive: false }))
    expect(fixture.updateReservation).toHaveBeenNthCalledWith(1, 'account-1', 'r1', { tableId: 't4' })
    expect(fixture.updateReservation).toHaveBeenNthCalledWith(2, 'account-1', 'r2', { tableId: null })
  })

  it('卓を追加するは窓（gBrCz）から createTable へ送る', async () => {
    render(<TablesPage />)
    await screen.findByText('フロアマップ')
    fireEvent.click(screen.getByRole('button', { name: /卓を追加する/ }))
    expect(document.querySelector('[data-design-node="gBrCz"]')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('卓番'), { target: { value: 'T5' } })
    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: '窓側2人卓' } })
    fireEvent.click(screen.getByRole('button', { name: /^追加する$/ }))
    await waitFor(() => expect(fixture.createTable).toHaveBeenCalledWith('account-1', expect.objectContaining({ storeId: 'store-1', code: 'T5', label: '窓側2人卓', minCapacity: 1, maxCapacity: 2 })))
  })

  it('閲覧のみ（staff）には追加・変更・停止を置かない', async () => {
    role.value = 'staff'
    render(<TablesPage />)
    await screen.findByText('フロアマップ')
    expect(screen.queryByRole('button', { name: /卓を追加する/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /を停止$/ })).toBeNull()
  })

  it('移す先は人数が入り重ならない卓のうち、余る席がいちばん少ない卓', () => {
    const r = reservation('x', { guest_count: 2, starts_at: at(1, 18), ends_at: at(1, 20), table_id: 't3' })
    expect(pickMoveTarget(r, tables.filter((t) => t.id !== 't3'), [])?.id).toBe('t1')
    expect(pickMoveTarget(r, tables.filter((t) => t.id !== 't3'), [reservation('y', { table_id: 't1', starts_at: at(1, 19), ends_at: at(1, 21) })])?.id).toBe('t2')
  })
})
