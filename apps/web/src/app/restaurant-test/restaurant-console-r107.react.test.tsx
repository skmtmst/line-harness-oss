// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), updateMembership: vi.fn(), updateTable: vi.fn(), updateMenu: vi.fn() }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/components/layout/header', () => ({ default: () => null }))
vi.mock('./stores/store-context-banner', () => ({ default: () => null }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))

import RestaurantConsole from './restaurant-console'

const store = { id: 'store-1', organization_id: 'org-1', name: '銀座店', code: 'GINZA', area: null, capacity: 4, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'unconfigured', line_account_id: 'account-1', line_account_name: '銀座' }
const data = {
  organization: { id: 'org-1', account_id: 'account-1', tenant_id: null, tenant_name: null, name: 'テスト組織', status: 'active' },
  stores: [store], memberships: [{ id: 'member-1', store_id: 'store-1', staff_name: '佐藤', email: null, role: 'staff', line_uid: null, google_email: null, status: 'active' }],
  tables: [{ id: 'table-1', store_id: 'store-1', code: 'A1', label: '窓際', seat_type: 'table', min_capacity: 1, max_capacity: 4, floor_x: 0, floor_y: 0, join_group: null, is_active: 1 }],
  menuItems: [{ id: 'menu-1', store_id: 'store-1', kind: 'course', name: 'ランチ', price: 1500, tax_mode: 'tax_included', allergens_json: '[]', service_periods_json: '["lunch"]', duration_minutes: null, status: 'active' }],
  reservations: [], reservationTotal: 0, inventory: [], approvals: [], connectors: [], reviews: [], posts: [], lineFlows: [],
}

beforeEach(() => {
  fixture.snapshot.mockResolvedValue({ data })
  for (const key of ['updateMembership', 'updateTable', 'updateMenu'] as const) fixture[key].mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('R107 飲食店向け名簿・卓・メニューの操作', () => {
  it('卓を編集し、停止の確認を経て変更APIへ渡す', async () => {
    render(<RestaurantConsole view="tables" />)
    const detail = await screen.findByRole('heading', { name: '卓の詳細' })
    const panel = detail.closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: '変更' }))
    fireEvent.change(screen.getByDisplayValue('窓際'), { target: { value: '奥席' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 'table-1', expect.objectContaining({ label: '奥席' })))
    fireEvent.click(within(panel).getByRole('button', { name: '停止' }))
    fireEvent.click(screen.getByRole('button', { name: '停止する' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 'table-1', { isActive: false }))
  })

  it('メニューを編集し、保管の確認を経て変更APIへ渡す', async () => {
    render(<RestaurantConsole view="menu" />)
    const panel = (await screen.findByRole('heading', { name: 'メニュー一覧' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: '変更' }))
    fireEvent.change(screen.getByDisplayValue('ランチ'), { target: { value: '夜コース' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'menu-1', expect.objectContaining({ name: '夜コース' })))
    fireEvent.click(within(panel).getByRole('button', { name: '停止' }))
    fireEvent.click(screen.getByRole('button', { name: '停止する' }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'menu-1', { status: 'archived' }))
  })

  it.each([
    ['tables', 'tables', 'updateTable', 'table-1', { isActive: true }, { is_active: 0 }],
    ['menu', 'menuItems', 'updateMenu', 'menu-1', { status: 'active' }, { status: 'archived' }],
    ['organization', 'memberships', 'updateMembership', 'member-1', { status: 'active' }, { status: 'suspended' }],
  ] as const)('%sの停止済み記録を再開できる', async (view, key, method, id, expected, patch) => {
    fixture.snapshot.mockResolvedValue({ data: { ...data, [key]: [{ ...data[key][0], ...patch }] } })
    render(<RestaurantConsole view={view} />)
    fireEvent.click(await screen.findByRole('button', { name: '再開' }))
    await waitFor(() => expect(fixture[method]).toHaveBeenCalledWith('account-1', id, expected))
  })

  it('昼・夜の両方を提供する既存メニューは、編集しても両方を残す', async () => {
    fixture.snapshot.mockResolvedValue({ data: { ...data, menuItems: [{ ...data.menuItems[0], service_periods_json: '["lunch","dinner"]' }] } })
    render(<RestaurantConsole view="menu" />)
    const panel = (await screen.findByRole('heading', { name: 'メニュー一覧' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: '変更' }))
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'menu-1', expect.objectContaining({ servicePeriods: ['lunch', 'dinner'] })))
  })

  it('所属ユーザーを編集し、停止の確認を経て変更APIへ渡す', async () => {
    render(<RestaurantConsole view="organization" />)
    const panel = (await screen.findByRole('heading', { name: 'アカウント一覧' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: '変更' }))
    fireEvent.change(screen.getByDisplayValue('佐藤'), { target: { value: '田中' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    await waitFor(() => expect(fixture.updateMembership).toHaveBeenCalledWith('account-1', 'member-1', expect.objectContaining({ staffName: '田中' })))
    fireEvent.click(within(panel).getByRole('button', { name: '停止' }))
    fireEvent.click(screen.getByRole('button', { name: '停止する' }))
    await waitFor(() => expect(fixture.updateMembership).toHaveBeenCalledWith('account-1', 'member-1', { status: 'suspended' }))
  })
})
