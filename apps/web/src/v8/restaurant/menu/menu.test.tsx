// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 日付の見本を作る前に日本時間で固定し、待ち合わせのタイマーは動かす。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T12:00:00+09:00'))
})

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), createMenu: vi.fn(), updateMenu: vi.fn() }))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const fetchApi = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/lib/api', async (load) => ({ ...(await load<typeof import('@/lib/api')>()), fetchApi }))
const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  useRouter: () => ({ push: nav.push, replace: nav.push, back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/restaurant-test/menu',
}))

import MenuPage from './menu'
import MenuEditPage from './edit'
import { snapshotOf } from '../booking-kit/test-data'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T12:00:00+09:00'))
  role.value = 'owner'
  nav.params = new URLSearchParams()
  fixture.snapshot.mockResolvedValue({ data: snapshotOf() })
  fixture.createMenu.mockResolvedValue({ success: true })
  fixture.updateMenu.mockResolvedValue({ success: true })
  fetchApi.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

const openMenu = (name: string) => fireEvent.click(screen.getByRole('button', { name: `メニュー「${name}」の操作` }))

/* ★V8 メニュー管理（板 ・停止 ・追加と変更 ）の動き。 */
describe('MJoJR メニュー管理', () => {
  it('数5・「…」の決まりの帯・一覧が出て、アーカイブだけ再開が出る', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    const board = document.querySelector('[data-design-node="MJoJR"]')!
    for (const label of ['全メニュー', 'コース', '単品', '要承認', 'アレルギー登録', '「…」の中身']) expect(board.textContent).toContain(label)
    expect(screen.getAllByRole('button', { name: '再開' })).toHaveLength(1)
  })

  it('「…」の変更と名前は、前の窓ではなく 1 枚の編集ページ（mauOC）へ進む', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    openMenu('秋の鹿肉コース')
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/restaurant-test/menu/edit?id=m1'))
    expect(document.querySelector('[data-design-node="NkmwU"]')).toBeNull()
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

  it('メニューを追加するは選んでいる店舗で編集ページを開く', async () => {
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    fireEvent.click(screen.getByRole('button', { name: /メニューを追加する/ }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/restaurant-test/menu/edit?store=store-1'))
  })

  it('閲覧のみ（staff）には追加・「…」・再開を置かない', async () => {
    role.value = 'staff'
    render(<MenuPage />)
    await screen.findByText('メニュー一覧')
    expect(screen.getByText('閲覧のみで見ています。変える操作はオーナーか管理者に頼んでください。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /メニューを追加する/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /の操作$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '再開' })).toBeNull()
  })
})

describe('mauOC コースの編集ページ', () => {
  it('変更して保存すると、今の口（updateMenu）へ届き一覧へ戻る', async () => {
    nav.params = new URLSearchParams('id=m1')
    render(<MenuEditPage />)
    const name = await screen.findByLabelText('メニュー名')
    fireEvent.change(name, { target: { value: '冬の鹿肉コース' } })
    fireEvent.click(screen.getByRole('button', { name: /保存する/ }))
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'm1', expect.objectContaining({ name: '冬の鹿肉コース', servicePeriods: ['dinner'] })))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/restaurant-test/menu'))
  })

  it('価格を変えると「保存して申請する」になり、開始日時を添えて送る', async () => {
    nav.params = new URLSearchParams('id=m1')
    render(<MenuEditPage />)
    fireEvent.change(await screen.findByLabelText('価格（税込）'), { target: { value: '9900' } })
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
    await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledWith('account-1', 'm1', expect.objectContaining({ price: 9900, effectiveAt: new Date(`${ymd}T10:00:00+09:00`).toISOString() })))
  })

  it('追加は店舗を添えて createMenu へ送る', async () => {
    nav.params = new URLSearchParams('store=store-1')
    render(<MenuEditPage />)
    fireEvent.change(await screen.findByLabelText('メニュー名'), { target: { value: '冬のコース' } })
    fireEvent.change(screen.getByLabelText('価格（税込）'), { target: { value: '7000' } })
    fireEvent.click(screen.getByRole('button', { name: /保存して追加する/ }))
    await waitFor(() => expect(fixture.createMenu).toHaveBeenCalledWith('account-1', expect.objectContaining({ storeId: 'store-1', name: '冬のコース', price: 7000 })))
  })

  it('保存に失敗したら入力を残して知らせ、一覧へ戻らない', async () => {
    nav.params = new URLSearchParams('id=m1')
    fixture.updateMenu.mockRejectedValueOnce(new Error('network'))
    render(<MenuEditPage />)
    fireEvent.change(await screen.findByLabelText('メニュー名'), { target: { value: '冬の鹿肉コース' } })
    fireEvent.click(screen.getByRole('button', { name: /保存する/ }))
    expect(await screen.findByText(/保存できませんでした/)).toBeTruthy()
    expect((screen.getByLabelText('メニュー名') as HTMLInputElement).value).toBe('冬の鹿肉コース')
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('一度も公開していない下書きだけ、下の帯の［削除する］から DELETE の口へ届く', async () => {
    nav.params = new URLSearchParams('id=m1')
    const { unmount } = render(<MenuEditPage />)
    await screen.findByLabelText('メニュー名')
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
    unmount()
    nav.params = new URLSearchParams('id=m4')
    render(<MenuEditPage />)
    await screen.findByLabelText('メニュー名')
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))
    const confirm = await screen.findAllByRole('button', { name: '削除する' })
    fireEvent.click(confirm[confirm.length - 1])
    await waitFor(() => expect(fetchApi).toHaveBeenCalledWith('/api/restaurant-test/menus/m4?account_id=account-1', { method: 'DELETE' }))
  })

  it('閲覧のみでも提供時間と所要時間を読み、保存はできない', async () => {
    role.value = 'staff'
    nav.params = new URLSearchParams('id=m1')
    render(<MenuEditPage />)
    expect(await screen.findByText('メニューの内容')).toBeTruthy()
    expect(screen.getByText('所要時間')).toBeTruthy()
    expect(screen.getByText('アレルギー')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /保存/ })).toBeNull()
    expect(screen.queryByLabelText('メニュー名')).toBeNull()
    expect(fixture.updateMenu).not.toHaveBeenCalled()
  })

  it('閲覧では現在の価格と変更予定の価格を別々に読む', async () => {
    role.value = 'staff'
    const data = snapshotOf()
    data.menuItems[0] = { ...data.menuItems[0], price: 1200, pendingPrice: 2500 }
    fixture.snapshot.mockResolvedValue({ data })
    nav.params = new URLSearchParams(`id=${data.menuItems[0].id}`)
    render(<MenuEditPage />)
    expect(await screen.findByText('¥1,200')).toBeTruthy()
    expect(screen.getByText('変更予定の価格')).toBeTruthy()
    expect(screen.getByText('¥2,500')).toBeTruthy()
  })
})
