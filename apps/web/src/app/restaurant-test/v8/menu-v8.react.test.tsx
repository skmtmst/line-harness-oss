// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), createMenu: vi.fn(), updateMenu: vi.fn() }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))

import MenuV8 from './menu'

const store = { id: 'store-1', organization_id: 'org-1', name: '渋谷店', code: 'SHIBUYA', area: null, capacity: 26, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'unconfigured', line_account_id: 'account-1', line_account_name: '渋谷' }
const data = {
  organization: { id: 'org-1', account_id: 'account-1', tenant_id: null, tenant_name: null, name: 'テスト組織', status: 'active' },
  stores: [store],
  memberships: [],
  tables: [],
  menuItems: [
    { id: 'm1', store_id: 'store-1', kind: 'course', name: '秋の鹿肉コース', price: 8800, tax_mode: 'tax_included', allergens_json: '["小麦","乳"]', service_periods_json: '["dinner"]', duration_minutes: 120, status: 'active' },
    { id: 'm2', store_id: 'store-1', kind: 'a_la_carte', name: '鹿肉のロースト', price: 2400, tax_mode: 'tax_included', allergens_json: '[]', service_periods_json: '["lunch","dinner"]', duration_minutes: null, status: 'active' },
    { id: 'm3', store_id: 'store-1', kind: 'course', name: '夏の冷製コース', price: 6600, tax_mode: 'tax_included', allergens_json: '["小麦"]', service_periods_json: '["dinner"]', duration_minutes: 120, status: 'archived' },
  ],
  reservations: [], reservationTotal: 0, inventory: [],
  approvals: [{ id: 'a1', store_id: 'store-1', kind: 'menu_change', title: '価格改定', status: 'pending', requested_by: null, review_comment: null, payload_json: null }],
  connectors: [], reviews: [], posts: [], lineFlows: [],
}

beforeEach(() => {
  fixture.snapshot.mockResolvedValue({ data })
  fixture.createMenu.mockResolvedValue({ success: true })
  fixture.updateMenu.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

/*
 * ★V8-B メニュー管理（板 `MJoJR`）の契約。
 * 数5・決まりの帯・一覧の表（行末は「…」・保管済みだけ再開）が出て、
 * 操作が今の口へ届くことを固定する。
 */
describe('MJoJR メニュー管理のV8', () => {
  it('数5と決まりの帯・一覧が出る', async () => {
    render(<MenuV8 />)
    await screen.findByText('メニュー一覧')
    const board = document.querySelector('[data-design-node="MJoJR"]')!
    for (const label of ['全メニュー', 'コース', '単品', '要承認', 'アレルギー登録']) {
      expect(board.textContent).toContain(label)
    }
    expect(board.textContent).toContain('「…」の中身')
    expect(board.textContent).toContain('秋の鹿肉コース')
    expect(board.textContent).toContain('ランチ・ディナー')
  })

  it('保管済みだけ再開ボタンが出る', async () => {
    render(<MenuV8 />)
    await screen.findByText('メニュー一覧')
    expect(screen.getAllByRole('button', { name: '再開' })).toHaveLength(1)
  })

  it('一覧から変更・停止が今の口へ届く', async () => {
    render(<MenuV8 />)
    await screen.findByText('メニュー一覧')
    const row = screen.getByText('秋の鹿肉コース').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /その他操作|操作/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))
    fireEvent.change(screen.getByDisplayValue('秋の鹿肉コース'), { target: { value: '冬の鹿肉コース' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'm1', expect.objectContaining({ name: '冬の鹿肉コース' })))
  })
})
