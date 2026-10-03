// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), createTable: vi.fn(), updateTable: vi.fn() }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))

import TablesV8 from './tables'

const store = { id: 'store-1', organization_id: 'org-1', name: '渋谷店', code: 'SHIBUYA', area: null, capacity: 26, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'unconfigured', line_account_id: 'account-1', line_account_name: '渋谷' }
const data = {
  organization: { id: 'org-1', account_id: 'account-1', tenant_id: null, tenant_name: null, name: 'テスト組織', status: 'active' },
  stores: [store],
  memberships: [],
  tables: [
    { id: 't1', store_id: 'store-1', code: 'T1', label: '2人卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 0, floor_y: 0, join_group: null, is_active: 1 },
    { id: 't2', store_id: 'store-1', code: 'T2', label: '2人卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 1, floor_y: 0, join_group: 'A', is_active: 1 },
    { id: 't3', store_id: 'store-1', code: 'T3', label: '窓側4人卓', seat_type: 'table', min_capacity: 2, max_capacity: 4, floor_x: 2, floor_y: 0, join_group: 'A', is_active: 1 },
    { id: 'pb', store_id: 'store-1', code: '個室B', label: '個室', seat_type: 'private_room', min_capacity: 4, max_capacity: 8, floor_x: 0, floor_y: 1, join_group: null, is_active: 0 },
  ],
  menuItems: [],
  reservations: [], reservationTotal: 0, inventory: [], approvals: [], connectors: [], reviews: [], posts: [], lineFlows: [],
}

beforeEach(() => {
  fixture.snapshot.mockResolvedValue({ data })
  fixture.createTable.mockResolvedValue({ success: true })
  fixture.updateTable.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

/*
 * ★V8-B 座席・卓管理（板 `BERxg`）の契約。
 * 数4・マップ（選ぶと結合札）・詳細（変更・停止／再開）・配席ルールが
 * 板どおりに出て、操作が今の口へ届くことを固定する。
 */
describe('BERxg 座席・卓管理のV8', () => {
  it('数4とマップ・詳細・ルールが出る', async () => {
    render(<TablesV8 />)
    await screen.findByText('フロアマップ')
    const board = document.querySelector('[data-design-node="BERxg"]')!
    expect(board.textContent).toContain('卓数')
    expect(board.textContent).toContain('総席数')
    expect(board.textContent).toContain('結合可能')
    expect(board.textContent).toContain('個室')
    expect(board.textContent).toContain('フロアマップ')
    expect(board.textContent).toContain('卓の詳細')
    expect(board.textContent).toContain('自動配席ルール')
  })

  it('マップの卓を選ぶと結合札が出る', async () => {
    render(<TablesV8 />)
    await screen.findByText('フロアマップ')
    expect(screen.queryByText('結合 A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /T2 2人卓/ }))
    expect(screen.getByText('結合 A')).not.toBeNull()
  })

  it('卓の詳細から変更・停止・再開が今の口へ届く', async () => {
    render(<TablesV8 />)
    const detail = (await screen.findByRole('heading', { name: '卓の詳細' })).closest('section')!
    fireEvent.click(within(detail).getAllByRole('button', { name: '変更' })[0])
    fireEvent.change(screen.getByDisplayValue('2人卓'), { target: { value: '奥の2人卓' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 't1', expect.objectContaining({ label: '奥の2人卓' })))
    fireEvent.click(within(detail).getAllByRole('button', { name: '停止' })[0])
    fireEvent.click(screen.getByRole('button', { name: '停止する' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 't1', { isActive: false }))
    fireEvent.click(within(detail).getByRole('button', { name: '再開' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 'pb', { isActive: true }))
  })
})
