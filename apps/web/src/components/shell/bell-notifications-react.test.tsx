// @vitest-environment happy-dom
/*
 * ★V8 上の帯のベルの小窓（V8.pen DIHFx/D2eAyQ・小窓 mV28V・オーナー 2026-10-07）。
 *
 *   - ベルを押すと、ページを移らずに小窓（role=dialog「通知」）が開く。もう一度押すと閉じる
 *   - タブは「すべて・未読・システム」。未読は口の unread=1、システムは category=error で読む
 *   - Esc で閉じ、焦点はベルへ戻る。小窓の外を押しても閉じる。小窓の中を押しても閉じない
 *   - 一覧は最大5件・未読が先。行を押すと既読にして行き先へ移る
 *   - すべて既読は押した瞬間に反映し、失敗したら戻す
 *   - 店を選んでいないときは読まずに案内だけ
 *   - 小窓を渡さない帯（管理画面 など）は、今までどおり通知の一覧へのリンク
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationCenterItem } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  role: 'owner' as string | null,
  push: vi.fn(),
  list: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  changeAccount: vi.fn((_id: string, after?: () => void) => after?.()),
  toast: vi.fn(),
}))
vi.mock('@/lib/staff-role', async (original) => ({ ...(await original<object>()), useStaffRole: () => fixture.role }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fixture.push }), usePathname: () => '/' }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...props }, children) }
})
vi.mock('@/lib/api', () => ({
  api: { notifications: { center: { list: fixture.list, markRead: fixture.markRead, markAllRead: fixture.markAllRead } } },
}))
vi.mock('@/components/shared/toast', async (original) => ({ ...(await original<object>()), notifyToast: fixture.toast, notifySaved: fixture.toast }))

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

function Harness({ accountId = 'account-1', accounts = [], withPopover = true }: { accountId?: string | null; accounts?: Array<{ id: string; label: string }>; withPopover?: boolean }) {
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
        <BellNotifications popover={popover} accountId={accountId} accounts={accounts} onAccountChange={fixture.changeAccount} onUnreadChange={setUnread} />
      ) : undefined}
      v8Chrome
      chromeVariant="shell"
    />
  )
}

const bell = () => screen.getByRole('button', { name: /^通知(（未読 \d+ 件）)?$/ })

async function openPopover() {
  await act(async () => { fireEvent.click(bell()) })
  return screen.findByRole('dialog', { name: '通知' })
}

describe('★V8 ベルの小窓', () => {
  beforeEach(() => {
    fixture.role = 'owner'
    document.documentElement.dataset.theme = 'v8'
    fixture.push.mockReset()
    fixture.toast.mockReset()
    fixture.list.mockReset()
    fixture.markRead.mockReset()
    fixture.markAllRead.mockReset()
    fixture.changeAccount.mockClear()
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

  it.each(['viewer', null])('権限が %s の間は既読操作を出さず、通知の移動はできる', async (role) => {
    fixture.role = role
    render(<Harness />)
    const panel = await openPopover()
    await within(panel).findByText('未読のエラー')
    expect(within(panel).queryByRole('button', { name: 'すべて既読にする' })).toBeNull()
    await act(async () => { fireEvent.click(within(panel).getByText('未読のエラー')) })
    expect(fixture.markRead).not.toHaveBeenCalled()
    expect(fixture.markAllRead).not.toHaveBeenCalled()
    expect(fixture.push).toHaveBeenCalled()
  })

  it('統括では全アカウントの通知をまとめ、通知を押すと対象アカウントへ切り替えて知らせる', async () => {
    render(<Harness accountId={null} accounts={[{ id: 'account-1', label: '本店' }, { id: 'account-2', label: '渋谷店' }]} />)
    const panel = await openPopover()
    await within(panel).findByText('本店：未読のエラー')
    expect(fixture.list).toHaveBeenCalledTimes(2)
    expect(within(panel).getByText('渋谷店：未読のエラー')).toBeTruthy()
    await act(async () => { fireEvent.click(within(panel).getByText('渋谷店：未読のエラー')) })
    expect(fixture.changeAccount).toHaveBeenCalledWith('account-2', expect.any(Function))
    expect(fixture.toast).toHaveBeenCalledWith('渋谷店 に切り替えました', { tone: 'info' })
    expect(fixture.push).toHaveBeenCalled()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
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
    expect(screen.queryByRole('dialog', { name: '通知' })).toBeNull()
    expect(bell().getAttribute('aria-expanded')).toBe('false')
  })

  it('Esc で閉じて焦点がベルへ戻る', async () => {
    render(<Harness />)
    await openPopover()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog', { name: '通知' })).toBeNull()
    expect(document.activeElement).toBe(bell())
  })

  it('上の帯の端ではなく、押したベルの下から開く', async () => {
    render(<Harness />)
    vi.spyOn(bell(), 'getBoundingClientRect').mockReturnValue(new DOMRect(800, 60, 36, 36))
    const dialog = await openPopover()
    expect(dialog.parentElement?.style.top).toBe('100px')
  })

  it('小窓の外を押すと閉じ、中を押しても閉じない', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await act(async () => { fireEvent.pointerDown(within(dialog).getByText('通知', { selector: 'h2' })) })
    expect(screen.getByRole('dialog', { name: '通知' })).toBeTruthy()
    await act(async () => { fireEvent.pointerDown(document.body) })
    expect(screen.queryByRole('dialog', { name: '通知' })).toBeNull()
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
    expect(fixture.list).toHaveBeenCalledWith('account-1', { limit: 50 })
  })

  it('タブは「すべて・未読・システム」。アップデートのタブは無い', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    const tabs = within(dialog).getByRole('group', { name: '通知の種類' })
    expect(within(tabs).getAllByRole('button').map((button) => button.textContent)).toEqual(['すべて', '未読', 'システム'])
    expect(within(dialog).queryByRole('button', { name: 'アップデート' })).toBeNull()
  })

  it('未読のタブは口で未読だけに絞って読む（先頭5件に切っても6件目より後ろの未読が埋もれない）', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    const buried = [1, 2, 3, 4, 5, 6].map((n) => item(`old-unread-${n}`, { title: `古い未読 ${n}`, createdAt: `2026-09-0${n}T00:00:00.000Z` }))
    fixture.list.mockImplementation(async (_account: string, query: { unread?: boolean }) => centerData(query.unread ? buried.slice(4) : []))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '未読' })) })
    await waitFor(() => expect(fixture.list).toHaveBeenLastCalledWith('account-1', { unread: true, limit: 50 }))
    expect(await within(dialog).findByText('古い未読 6')).toBeTruthy()
  })

  it('システムのタブは運用の異常（category=error）で読み直す', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'システム' })) })
    await waitFor(() => expect(fixture.list).toHaveBeenLastCalledWith('account-1', { category: 'error', limit: 50 }))
  })

  it.each([
    ['owner', '更新する →'],
    ['admin', '更新する →'],
    ['staff', 'アカウントを見る →'],
    ['viewer', 'アカウントを見る →'],
    [null, 'アカウントを見る →'],
  ])('LINE の鍵の知らせは、そのアカウントの設定へ。権限 %s の行の言葉は %s', async (role, label) => {
    fixture.role = role
    fixture.list.mockResolvedValue(centerData([item('token', { eventType: 'line_token_expiring', title: 'LINEの鍵があと6日で切れます' })]))
    render(<Harness />)
    const dialog = await openPopover()
    const row = await within(dialog).findByRole('button', { name: /LINEの鍵があと6日で切れます/ })
    expect(row.textContent).toContain(label)
    await act(async () => { fireEvent.click(row) })
    expect(fixture.push).toHaveBeenCalledWith('/accounts/detail?id=account-1')
  })

  it('日本時間の今日とそれより前に分け、各組の中では未読を先にする', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T15:30:00.000Z'))
    fixture.list.mockResolvedValue(centerData([
      item('today-read', { title: '今日の既読', isRead: true, createdAt: '2026-10-22T15:20:00Z' }),
      item('earlier', { title: '前の日の未読', createdAt: '2026-10-22T14:59:59Z' }),
      item('today-unread', { title: '今日の未読', createdAt: '2026-10-22 15:00:00' }),
    ]))
    render(<Harness />)
    const dialog = await openPopover()
    const today = await within(dialog).findByRole('region', { name: '今日' })
    expect(within(today).getAllByRole('listitem').map(row => row.textContent)).toEqual([
      expect.stringContaining('今日の未読'), expect.stringContaining('今日の既読'),
    ])
    const earlier = within(dialog).getByRole('region', { name: 'それより前' })
    expect(within(earlier).getByText('前の日の未読')).toBeTruthy()
    expect(within(dialog).getAllByRole('region').map(region => region.getAttribute('aria-label'))).toEqual(['今日', 'それより前'])
  })

  it('日時が壊れた通知を消さず、不明として読める。空の日付の組は出さない', async () => {
    fixture.list.mockResolvedValue(centerData([item('unknown', { createdAt: 'invalid', title: '日時のない通知' })]))
    render(<Harness />)
    const dialog = await openPopover()
    const unknown = await within(dialog).findByRole('region', { name: '日時不明' })
    expect(within(unknown).getByText('日時のない通知')).toBeTruthy()
    expect(within(dialog).queryByRole('region', { name: '今日' })).toBeNull()
    expect(within(dialog).queryByRole('region', { name: 'それより前' })).toBeNull()
  })

  it('行を押すと既読にして行き先へ移り、小窓を閉じる。ベルの数も減る', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 3')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /EC連携が止まった/ })) })
    expect(fixture.markRead).toHaveBeenCalledWith('u3', 'account-1')
    expect(fixture.push).toHaveBeenCalledWith('/ec-commerce')
    expect(screen.queryByRole('dialog', { name: '通知' })).toBeNull()
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

  it('統括で一部のアカウントの既読処理が失敗したら未読数を戻して知らせる', async () => {
    fixture.markAllRead.mockImplementation(async (accountId: string) => accountId === 'account-2'
      ? { success: false, error: '保存できませんでした' }
      : { success: true, data: { updated: 3 } })
    render(<Harness accountId={null} accounts={[{ id: 'account-1', label: '本店' }, { id: 'account-2', label: '渋谷店' }]} />)
    const dialog = await openPopover()
    await within(dialog).findByText('未読 6')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'すべて既読にする' })) })
    await within(dialog).findByText('未読 6')
    expect(fixture.markAllRead.mock.calls.map(([id]) => id)).toEqual(['account-1', 'account-2'])
    expect(fixture.toast).toHaveBeenCalledWith('通知をまとめて既読にできませんでした。', expect.objectContaining({ tone: 'error' }))
  })

  it('閉じた小窓の遅い読込結果はベルの未読数を変えない', async () => {
    let finish!: (value: ReturnType<typeof centerData>) => void
    fixture.list.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<Harness />)
    await openPopover()
    await waitFor(() => expect(fixture.list).toHaveBeenCalled())
    await act(async () => { fireEvent.click(bell()) })
    await act(async () => { finish(centerData([])) })
    expect(bell().getAttribute('aria-label')).toBe('通知（未読 3 件）')
  })

  it('すべて見るは小窓を閉じて通知の画面へ。下に押すものは「すべて見る」1つだけ（歯車は置かない）', async () => {
    render(<Harness />)
    const dialog = await openPopover()
    expect(within(dialog).queryByRole('button', { name: '通知設定' })).toBeNull()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'すべて見る →' })) })
    expect(fixture.push).toHaveBeenLastCalledWith('/notifications')
    expect(screen.queryByRole('dialog', { name: '通知' })).toBeNull()
  })

  it('店を選んでいないとき（統括）は読まずに案内だけ', async () => {
    render(<Harness accountId={null} />)
    const dialog = await openPopover()
    expect(within(dialog).getByText('LINEアカウントを選ぶと、そのアカウントの通知が出ます。')).toBeTruthy()
    expect(fixture.list).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'すべて見る →' })).toBeTruthy()
  })

  it('小窓を渡さない帯は、今までどおり通知の一覧へのリンク', () => {
    render(<Harness withPopover={false} />)
    const link = screen.getByRole('link', { name: /^通知/ })
    expect(link.getAttribute('href')).toBe('/notifications')
  })
})
