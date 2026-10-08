// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), createMenu: vi.fn(), updateMenu: vi.fn() }))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const fetchApi = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/lib/api', async (load) => ({ ...(await load<typeof import('@/lib/api')>()), fetchApi }))

import MenuPage from './menu'
import { snapshotOf } from '../booking-kit/test-data'

beforeEach(() => {
  role.value = 'owner'
  fixture.snapshot.mockResolvedValue({ data: snapshotOf() })
  fixture.createMenu.mockResolvedValue({ success: true })
  fixture.updateMenu.mockResolvedValue({ success: true })
  fetchApi.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const openMenu = (name: string) => fireEvent.click(screen.getByRole('button', { name: `メニュー「${name}」の操作` }))

/* ★V8 メニュー管理（板 MJoJR・停止 MV5Os・追加と変更 NkmwU）の動き。 */
describe('MJoJR メニュー管理', () => {
  it('数5・「…」の決まりの帯・一覧が出て、保管済みだけ再開が出る', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    const board = document.querySelector('[data-design-node="MJoJR"]')!
    for (const label of ['全メニュー', 'コース', '単品', '要承認', 'アレルギー登録', '「…」の中身']) expect(board.textContent).toContain(label)
    expect(screen.getAllByRole('button', { name: '再開' })).toHaveLength(1)
  })

  it('「…」の変更から窓（NkmwU）で保存すると、今の口へ届く', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    openMenu('秋の鹿肉コース')
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))
    expect(document.querySelector('[data-design-node="NkmwU"]')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('メニュー名'), { target: { value: '冬の鹿肉コース' } })
    fireEvent.click(screen.getByRole('button', { name: /保存する/ }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'm1', expect.objectContaining({ name: '冬の鹿肉コース', servicePeriods: ['dinner'] })))
  })

  it('価格を変えると「保存して申請する」になり、開始日時を添えて送る', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    openMenu('秋の鹿肉コース')
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))
    fireEvent.change(screen.getByLabelText('価格（税込）'), { target: { value: '9900' } })
    // 開始日時は共通の日時の欄（打つ・暦と時刻から選ぶ）。来月10日を選ぶと時刻は 10:00 で決まる。
    const next = new Date()
    next.setDate(1)
    next.setMonth(next.getMonth() + 1)
    const ymd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-10`
    fireEvent.click(screen.getByLabelText('新しい価格の開始日時'))
    const picker = screen.getByRole('dialog', { name: '日時を選ぶ' })
    fireEvent.click(within(picker).getByRole('button', { name: '日付' }))
    fireEvent.click(screen.getByRole('button', { name: '次の月' }))
    fireEvent.click(screen.getAllByRole('button').find((b) => (b.getAttribute('aria-label') ?? '').startsWith(`${next.getFullYear()}年${next.getMonth() + 1}月10日`))!)
    fireEvent.click(within(screen.getByRole('dialog', { name: '日時を選ぶ' })).getByRole('button', { name: '閉じる' }))
    fireEvent.click(screen.getByRole('button', { name: /保存して申請する/ }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'm1', expect.objectContaining({ price: 9900, effectiveAt: new Date(`${ymd}T10:00`).toISOString() })))
  })

  it('停止は確認の窓（MV5Os）を通って保管にする', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    openMenu('秋の鹿肉コース')
    fireEvent.click(screen.getByRole('menuitem', { name: '停止' }))
    const dialog = document.querySelector('[data-design-node="MV5Os"]') as HTMLElement
    expect(dialog).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '停止する' }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'm1', { status: 'archived' }))
  })

  it('一度も公開していない下書きだけ削除でき、DELETE の口へ届く', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    openMenu('秋の鹿肉コース')
    expect(screen.queryByRole('menuitem', { name: '削除' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    openMenu('春の下書きコース')
    fireEvent.click(screen.getByRole('menuitem', { name: '削除' }))
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(fetchApi).toHaveBeenCalledWith('/api/restaurant-test/menus/m4?account_id=account-1', { method: 'DELETE' }))
  })

  it('メニューを追加するは窓から createMenu へ送る', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    fireEvent.click(screen.getByRole('button', { name: /メニューを追加する/ }))
    fireEvent.change(screen.getByLabelText('メニュー名'), { target: { value: '冬のコース' } })
    fireEvent.change(screen.getByLabelText('価格（税込）'), { target: { value: '7000' } })
    fireEvent.click(screen.getByRole('button', { name: /保存して追加する/ }))
    await waitFor(() => expect(fixture.createMenu).toHaveBeenCalledWith('account-1', expect.objectContaining({ storeId: 'store-1', name: '冬のコース', price: 7000 })))
  })

  it('閲覧のみ（staff）には追加・「…」・再開を置かない', async () => {
    role.value = 'staff'
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    expect(screen.queryByRole('button', { name: /メニューを追加する/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /の操作$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '再開' })).toBeNull()
  })
})
