// @vitest-environment happy-dom
/*
 * 予約設定「回数券・月謝」（B2-1）：表・数の帯・販売の始め／やめ・閲覧のみの扱い。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ list: vi.fn(), holders: vi.fn(), start: vi.fn(), stop: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/api/helpers/gap3', () => ({ bookingPassPlansApi: api }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, bookingApi: { ...actual.bookingApi, listMenus: async () => ({ menus: [{ id: 'm1', name: 'ヨガ（初級）' }, { id: 'm2', name: '朝ヨガ' }, { id: 'm3', name: 'カット' }] }) } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/booking/menus', useSearchParams: () => new URLSearchParams() }))

const { default: PassesTabV8 } = await import('./passes-tab')

const plan = (over: Record<string, unknown>) => ({ id: 'p', kind: 'ticket', name: '回数券', price: 1000, count: 5, monthlyLimit: null, validDays: 180, menuIds: [], allowWithoutPass: true, status: 'draft', version: 1, ...over })
const PLANS = [
  plan({ id: 'p1', name: 'ヨガ 10 回券', price: 15000, count: 10, menuIds: ['m1', 'm2'], status: 'on_sale', version: 2 }),
  plan({ id: 'p2', kind: 'monthly', name: 'ヨガ 月 4 回', price: 9800, count: null, monthlyLimit: 4, validDays: 30, status: 'draft' }),
]

beforeEach(() => {
  api.list.mockResolvedValue({ success: true, data: { items: PLANS, total: 2, summary: { onSale: 1, holders: 86, expiringIn30d: 9, billingFailed: 1 } } })
  api.holders.mockImplementation(async (_a: string, id: string) => ({ success: true, data: { items: [], total: id === 'p1' ? 42 : 0 } }))
  api.start.mockResolvedValue({ success: true, data: { status: 'on_sale', version: 2 } })
  api.stop.mockResolvedValue({ success: true, data: { status: 'stopped', version: 3 } })
  api.create.mockResolvedValue({ success: true, data: PLANS[1] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('回数券・月謝の表', () => {
  it('数の帯と、種類ごとの回数・期限・値段・使える予約・持っている人・状態を出す', async () => {
    render(<PassesTabV8 accountId="a" canEdit />)
    await screen.findByText('ヨガ 10 回券')
    expect(screen.getByText('86')).toBeTruthy()
    expect(screen.getByText('10 回')).toBeTruthy()
    expect(screen.getByText('月 4 回')).toBeTruthy()
    expect(screen.getByText('買って 6 か月')).toBeTruthy()
    expect(screen.getByText('毎月')).toBeTruthy()
    expect(screen.getByText('¥15,000')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('ヨガ（初級）・朝ヨガ')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('42 人')).toBeTruthy())
    expect(within(screen.getByText('ヨガ 10 回券').closest('tr')!).getByText('販売中')).toBeTruthy()
    expect(screen.getByText('下書き')).toBeTruthy()
  })

  it('下書きの販売を始めるときは確かめの窓を出し、いまの版を添えて始める', async () => {
    render(<PassesTabV8 accountId="a" canEdit />)
    await screen.findByText('ヨガ 月 4 回')
    fireEvent.click(screen.getByRole('button', { name: 'ヨガ 月 4 回の操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '販売を始める' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('変えられません')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '販売を始める' })) })
    await waitFor(() => expect(api.start).toHaveBeenCalledWith('a', 'p2', 1))
  })

  it('販売中の券はやめることだけできる（編集は出ない）', async () => {
    render(<PassesTabV8 accountId="a" canEdit />)
    await screen.findByText('ヨガ 10 回券')
    fireEvent.click(screen.getByRole('button', { name: 'ヨガ 10 回券の操作' }))
    expect(await screen.findByRole('menuitem', { name: '販売をやめる' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '編集する' })).toBeNull()
  })

  it('閲覧のみの人には、変える操作を置かない（持っている人を見るだけ）', async () => {
    render(<PassesTabV8 accountId="a" canEdit={false} />)
    await screen.findByText('ヨガ 10 回券')
    fireEvent.click(screen.getByRole('button', { name: 'ヨガ 10 回券の操作' }))
    expect(await screen.findByRole('menuitem', { name: '持っている人を見る' })).toBeTruthy()
    for (const name of ['編集する', '販売を始める', '販売をやめる', '複製']) expect(screen.queryByRole('menuitem', { name })).toBeNull()
  })

  it('読み込みに失敗したら「もう一度」を出す', async () => {
    api.list.mockRejectedValueOnce(new Error('down'))
    render(<PassesTabV8 accountId="a" canEdit />)
    expect(await screen.findByRole('button', { name: /もう一度/ })).toBeTruthy()
  })
})
