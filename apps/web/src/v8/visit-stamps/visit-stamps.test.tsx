// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({
  role: 'owner' as string | null,
  cards: vi.fn(), save: vi.fn(), create: vi.fn(), paperRequests: vi.fn(), reviewPaper: vi.fn(), wallet: vi.fn(), grant: vi.fn(), reverse: vi.fn(), setPin: vi.fn(),
  friendsList: vi.fn(), friendsGet: vi.fn(), staffList: vi.fn(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [{ id: 'acc-1', name: '銀座店' }] }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fx.role, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => '/visit-stamps' }))
vi.mock('@/lib/visit-stamps-api', () => ({
  visitStampsApi: {
    cards: fx.cards, save: fx.save, create: fx.create, paperRequests: fx.paperRequests, reviewPaper: fx.reviewPaper,
    wallet: fx.wallet, grant: fx.grant, reverse: fx.reverse, setPin: fx.setPin,
  },
}))
vi.mock('@/lib/api', () => ({ api: { friends: { list: fx.friendsList, get: fx.friendsGet }, staff: { list: fx.staffList } } }))
import VisitStampsV8 from './visit-stamps'

const card = {
  id: 'card-1', name: '然 来店スタンプカード', accountIds: ['acc-1'], active: true, version: 3, expectedVersion: 3,
  settings: {
    mode: 'visit' as const, amountUnit: 1000, maxPerVisit: 3, firstVisitBonus: 1, expiryMonths: 6, timezone: 'Asia/Tokyo',
    multipliers: [], rankMultipliers: [], rewards: [{ id: 'r1', name: 'ドリンク 1杯', stamps: 5 }, { id: 'r2', name: 'デザート 1品', stamps: 10 }],
  },
}

beforeEach(() => {
  fx.role = 'owner'
  fx.cards.mockResolvedValue({ success: true, data: [card] })
  fx.save.mockResolvedValue({ success: true, data: card })
  fx.paperRequests.mockResolvedValue({ success: true, data: [{ id: 'p1', friend_id: 'f1', photo_url: '', stamps: 7, status: 'pending', created_at: '2026-01-12 11:14:00' }] })
  fx.reviewPaper.mockResolvedValue({ success: true, data: { id: 'p1', status: 'approved' } })
  fx.wallet.mockResolvedValue({ success: true, data: { wallet: { cardId: 'card-1', friendId: 'f1', balance: 3, earnedTotal: 3, expiresAt: null }, entries: [] } })
  fx.grant.mockResolvedValue({ success: true, data: {} })
  fx.friendsList.mockResolvedValue({ success: true, data: { items: [{ id: 'f1', displayName: 'みさき', metadata: { name: '鈴木 美咲' } }] } })
  fx.friendsGet.mockResolvedValue({ success: true, data: { id: 'f1', displayName: 'みさき' } })
  fx.staffList.mockResolvedValue({ success: true, data: [{ id: 's1', name: '田村', role: 'staff' }] })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, '', '/') })

describe('来店スタンプ（管理画面）', () => {
  it('カードの名前を変えて［保存する］で版を付けて保存する', async () => {
    render(<VisitStampsV8 />)
    const name = await screen.findByDisplayValue('然 来店スタンプカード')
    fireEvent.change(name, { target: { value: '新しいカード' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(fx.save).toHaveBeenCalledWith('card-1', expect.objectContaining({ name: '新しいカード', expectedVersion: 3, accountIds: ['acc-1'] })))
  })

  it('紙のカードの申請を承認すると、その申請を承認で送る', async () => {
    render(<VisitStampsV8 />)
    fireEvent.click(await screen.findByRole('button', { name: '鈴木 美咲さんの 7個を承認' }))
    await waitFor(() => expect(fx.reviewPaper).toHaveBeenCalledWith('p1', 'approve', expect.any(String)))
  })

  it('URL の友だちで店の手入力をすると、同じ requestId のまま理由とメモを送る', async () => {
    window.history.replaceState(null, '', '/visit-stamps?friend=f1')
    render(<VisitStampsV8 />)
    await screen.findByText('鈴木 美咲さんの記録はまだありません。')
    fireEvent.change(screen.getByPlaceholderText('例：レシートを確認済み'), { target: { value: 'レシートあり' } })
    fireEvent.click(screen.getByRole('button', { name: '1個ふやす' }))
    fireEvent.click(screen.getByRole('button', { name: '押印を足す' }))
    await waitFor(() => expect(fx.grant).toHaveBeenCalledWith('card-1', expect.objectContaining({ friendId: 'f1', count: 2, reason: '紙のカードから移す：レシートあり', source: 'paper' })))
  })

  it('担当者（staff）は承認と手入力ができ、カードの保存・暗証番号は出さない', async () => {
    fx.role = 'staff'
    render(<VisitStampsV8 />)
    expect(await screen.findByRole('button', { name: '鈴木 美咲さんの 7個を承認' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存する' })).toBeNull()
    expect(screen.queryByRole('button', { name: /店員の暗証番号/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /特典を足す/ })).toBeNull()
  })

  it('閲覧のみには変える操作を置かない', async () => {
    fx.role = 'viewer'
    render(<VisitStampsV8 />)
    await screen.findByDisplayValue('然 来店スタンプカード')
    expect(screen.queryByRole('button', { name: '保存する' })).toBeNull()
    expect(screen.queryByRole('button', { name: /承認/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '却下' })).toBeNull()
    expect(screen.queryByRole('button', { name: '押印を足す' })).toBeNull()
  })
})
