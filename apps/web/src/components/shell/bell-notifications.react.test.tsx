// @vitest-environment happy-dom
/*
 * ★V8 上の帯のベルの小窓（V8.pen DIHFx/D2eAyQ・小窓 mV28V・オーナー 2026-10-07）。
 *
 *   - ベルを押すと、ページを移らずに小窓（role=dialog「お知らせ」）が開く。もう一度押すと閉じる
 *   - Esc で閉じ、焦点はベルへ戻る。小窓の外を押しても閉じる。小窓の中を押しても閉じない
 *   - 一覧は最大5件・未読が先。行を押すと既読にして行き先へ移る
 *   - すべて既読は押した瞬間に反映し、失敗したら戻す
 *   - 店を選んでいないときは読まずに案内だけ
 *   - 小窓を渡さない帯（v7 など）は、今までどおり通知の一覧へのリンク
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationCenterItem } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  list: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fixture.push }), usePathname: () => '/' }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...props }, children) }
})
vi.mock('@/lib/api', () => ({
  api: { notifications: { center: { list: fixture.list, markRead: fixture.markRead, markAllRead: fixture.markAllRead } } },
}))
vi.mock('@/components/shared/toast', async (original) => ({ ...(await original<object>()), notifyToast: fixture.toast }))

import TopBar from '@/components/shared/top-bar'
import BellNotifications from './bell-notifications'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function item(id: string, over: Partial<NotificationCenterItem> = {}): NotificationCenterItem {
  return {
    id,
    eventType: 'broadcast.failed',
    category: 'error',
    title: `お知らせ ${id}`,
    body: '',
    metadata: null,
    isRead: false,
    createdAt: '2026-10-07T00:00:00.000Z',
    ...over,
  }
}

function centerData(items: NotificationCenterItem[]) {
  const unread = items.filter((row) => !row.isRead).length
  return {
    success: true,
    data: {
      items,
      counts: { all: items.length, error: items.filter((row) => row.category === 'error').length, update: items.filter((row) => row.category === 'update').length, unread },
      unreadCount: unread,
    },
  }
}

function Harness({ accountId = 'account-1', withPopover = true }: { accountId?: string | null; withPopover?: boolean }) {
  const [unread, setUnread] = useState(3)
  return (
    <TopBar
      title="ホーム"
      accounts={[{ id: 'account-1', label: '然 本店' }]}
      selectedAccountId={accountId ?? ''}
      onAccountChange={() => {}}
      roleLabel="オーナー"
      userName="Kenta"
      onLogout={() => {}}
      notificationUnreadCount={unread}
      renderNotifications={withPopover ? (popover) => (
        <BellNotifications popover={popover} accountId={accountId} onUnreadChange={setUnread} />
      ) : undefined}
      v8Chrome
      chromeVariant="shell"
    />
  )
}

const bell = () => screen.getByRole('button', { name: /^通知(（未読 \d+ 件）)?$/ })

async function openPopover() {
  await act(async () => { fireEvent.click(bell()) })
  return screen.findByRole('dialog', { name: 'お知らせ' })
}

describe('★V8 ベルの小窓', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'v8'
    fixture.push.mockReset()
    fixture.toast.mockReset()
    fixture.list.mockReset()
    fixture.markRead.mockReset()
    fixture.markAllRead.mockReset()
    fixture.markRead.mockResolvedValue({ success: true, data: null })
    fixture.markAllRead.mockResolvedValue({ success: true, data: { updated: 3 } })
    fixture.list.mockResolvedValue(centerData([
      item('r1', { isRead: true, title: '既読のお知らせ' }),
      item('u1', { title: '未読のエラー' }),
      item('u2', { category: 'update', eventType: 'release', title: '未読のアップデート' }),
      item('r2', { isRead: true }),
      item('r3', { isRead: true }),
      item('r4', { isRead: true }),
      item('u3', { eventType: 'ec.sync_failed', title: 'EC連携が止まった' }),
    ]))
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.theme
  })

  it('ベルを押すとページを移らずに小窓が開き、もう一度押すと閉じる', async () => {
    render(<Harness />)
    expect(bell().tagName).toBe('BUTTON')
    expect(bell().getAttribute('aria-haspopup')).toBe('dialog')
    expect(bell().getAttribute('aria-expanded')).toBe('false')
    const dialog = await openPopover()
    expect(bell().getAttribute('aria-expanded')).toBe('true')
    expect(bell().getAttribute('aria-controls')).toBe(dialog.id)
    expect(fixture.push).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(bell()) })
    expect(screen.queryByRole('dialog', { name: 'お知らせ' })).toBeNull()
    expect(bell().getAttribute('aria-expanded')).toBe('false')
  })

  it('Esc で閉じて焦点がベルへ戻る', async () => {
    render(<Harness />)
    await openPopover()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog', { name: 'お知らせ' })).toBeNull()
    expect(document.activeElement).toBe(bell())
  })

  it('小窓の外を押すと閉じ、中を押しても閉じない', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await act(async () => { fireEvent.pointerDown(within(dialog).getByText('お知らせ', { selector: 'h2' })) })
    expect(screen.getByRole('dialog', { name: 'お知らせ' })).toBeTruthy()
    await act(async () => { fireEvent.pointerDown(document.body) })
    expect(screen.queryByRole('dialog', { name: 'お知らせ' })).toBeNull()
  })

  it('最大5件・未読が先（新しい順のまま）。未読の数を頭に出す', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    const rows = within(dialog).getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.getAttribute('data-unread'))).toEqual(['true', 'true', 'true', 'false', 'false'])
    expect(rows[0].textContent).toContain('未読のエラー')
    expect(rows[2].textContent).toContain('EC連携を開く →')
    expect(fixture.list).toHaveBeenCalledWith('account-1', { category: 'all', limit: 50 })
  })

  it('分類を変えると、その分類で読み直す', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'エラー' })) })
    await waitFor(() => expect(fixture.list).toHaveBeenLastCalledWith('account-1', { category: 'error', limit: 50 }))
  })

  it('行を押すと既読にして行き先へ移り、小窓を閉じる。ベルの数も減る', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /EC連携が止まった/ })) })
    expect(fixture.markRead).toHaveBeenCalledWith('u3', 'account-1')
    expect(fixture.push).toHaveBeenCalledWith('/ec-commerce')
    expect(screen.queryByRole('dialog', { name: 'お知らせ' })).toBeNull()
    expect(bell().getAttribute('aria-label')).toBe('通知（未読 2 件）')
  })

  it('すべて既読は押した瞬間に反映し、失敗したら戻す', async () => {
    let fail: (value: unknown) => void = () => {}
    fixture.markAllRead.mockReturnValue(new Promise((resolve) => { fail = resolve }))
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'すべて既読にする' })) })
    expect(within(dialog).getByText('未読 0')).toBeTruthy()
    expect(fixture.markAllRead).toHaveBeenCalledWith('account-1', 'all')
    expect(bell().getAttribute('aria-label')).toBe('通知')
    await act(async () => { fail({ success: false, error: 'boom' }) })
    await within(dialog).findByText('未読 3')
    expect(fixture.toast).toHaveBeenCalled()
  })

  it('すべて見る・歯車は小窓を閉じて今のページへ', async () => {
    render(<Harness />)
    let dialog = await openPopover()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'すべて見る →' })) })
    expect(fixture.push).toHaveBeenLastCalledWith('/notifications')
    expect(screen.queryByRole('dialog', { name: 'お知らせ' })).toBeNull()
    dialog = await openPopover()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '通知設定' })) })
    expect(fixture.push).toHaveBeenLastCalledWith('/line-notifications?tab=operator')
  })

  it('店を選んでいないとき（統括）は読まずに案内だけ', async () => {
    render(<Harness accountId={null} />)
    const dialog = await openPopover()
    expect(within(dialog).getByText('LINEアカウントを選ぶと、そのアカウントのお知らせが出ます。')).toBeTruthy()
    expect(fixture.list).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'すべて見る →' })).toBeTruthy()
  })

  it('小窓を渡さない帯は、今までどおり通知の一覧へのリンク', () => {
    render(<Harness withPopover={false} />)
    const link = screen.getByRole('link', { name: /^通知/ })
    expect(link.getAttribute('href')).toBe('/notifications')
  })
})
