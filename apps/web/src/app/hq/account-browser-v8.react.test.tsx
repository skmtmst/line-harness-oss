// @vitest-environment happy-dom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import type { HqBrowserAccount } from './account-browser-v8'
import AccountBrowser from './account-browser-v8'
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('--color-status-info')
})
const tagA = { id: 't1', name: '渋谷エリア', color: '#2563eb' }
const tagB = { id: 't2', name: 'イベント', color: '#16a34a' }
const base = (part: Partial<HqBrowserAccount> & { id: string; name: string }): HqBrowserAccount => ({
  channelId: `channel-${part.id}`,
  basicId: `@${part.id}`,
  isActive: true,
  country: null,
  role: 'owner',
  displayOrder: 0,
  connection: { status: 'ok', checkedAt: null },
  stats: { friendCount: 0, messagesThisMonth: 0, activeScenarios: 0, staffCount: 1 },
  ...part,
})
const accounts: HqBrowserAccount[] = [
  base({ id: 'honten', name: '本店', displayOrder: 0, stats: { friendCount: 1284, messagesThisMonth: 1820, activeScenarios: 0, staffCount: 4 }, tags: [tagA] }),
  base({ id: 'shibuya', name: '渋谷店', displayOrder: 1, parentLineAccountId: 'honten', stats: { friendCount: 612, messagesThisMonth: 946, activeScenarios: 0, staffCount: 3 }, tags: [tagA] }),
  base({ id: 'test', name: 'TEST', displayOrder: 2, role: 'viewer', connection: { status: 'warn', checkedAt: null }, stats: { friendCount: 14, messagesThisMonth: 12, activeScenarios: 0, staffCount: 2 } }),
  base({ id: 'event', name: '2025年イベント', displayOrder: 3, stats: { friendCount: 238, messagesThisMonth: 634, activeScenarios: 0, staffCount: 2 }, tags: [tagB] }),
  base({ id: 'old', name: '旧キャンペーン', displayOrder: 4, archivedAt: '2026-09-01T00:00:00+09:00', stats: { friendCount: 0, messagesThisMonth: 0, activeScenarios: 0, staffCount: 0 }, tags: [tagB] }),
]
const props = (over: Partial<Parameters<typeof AccountBrowser>[0]> = {}) => ({
  accounts,
  onSelect: vi.fn(),
  onSettings: vi.fn(),
  onShowDetails: vi.fn(),
  onRestore: vi.fn(),
  onRefresh: vi.fn(),
  ...over,
})
describe('V8 統括のアカウント（板 JKjsE）', () => {
  it.each([
    { choice: '青', expected: '#175cd3' },
    { choice: 'なし', expected: null },
  ])('タグの色「$choice」をAPIで保存できる値にする', async ({ choice, expected }) => {
    document.documentElement.style.setProperty('--color-status-info', '#175cd3')
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => new Response(
      JSON.stringify({ success: true, data: init?.method === 'POST' ? { id: 'new' } : [] }),
      { headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetch)
    render(<AccountBrowser {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'タグを追加' }))
    const dialog = within(screen.getByRole('dialog', { name: 'タグを追加' }))
    fireEvent.change(dialog.getByRole('textbox', { name: '名前' }), { target: { value: '新しいタグ' } })
    fireEvent.click(dialog.getByRole('button', { name: `色：${choice}` }))
    fireEvent.click(dialog.getByRole('button', { name: '追加' }))
    await waitFor(() => {
      const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post![1]!.body as string)).toEqual({ name: '新しいタグ', color: expected })
    })
  })

  it('状態の札に数を出し、要確認だけに絞れる', () => {
    render(<AccountBrowser {...props()} />)
    const pills = within(screen.getByRole('group', { name: '状態で絞り込み' }))
    const pill = (name: string) => pills.getByRole('button', { name })
    expect(pill('すべて 5')).toBeTruthy()
    expect(pill('正常 3')).toBeTruthy()
    expect(pill('要確認 1')).toBeTruthy()
    expect(pill('アーカイブ 1')).toBeTruthy()
    fireEvent.click(pill('要確認 1'))
    expect(screen.getByText('TEST')).toBeTruthy()
    expect(screen.queryByText('本店')).toBeNull()
  })
  it('タグのフォルダで絞り、タグなしを出せる', () => {
    render(<AccountBrowser {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /渋谷エリア/ }))
    expect(screen.getByText('本店')).toBeTruthy()
    expect(screen.getByText('渋谷店')).toBeTruthy()
    expect(screen.queryByText('2025年イベント')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /タグなし/ }))
    expect(screen.getByText('TEST')).toBeTruthy()
    expect(screen.queryByText('本店')).toBeNull()
  })
  it('アーカイブは詳細と戻すだけ出し、友だちを伏せる', () => {
    const restore = vi.fn()
    const details = vi.fn()
    render(<AccountBrowser {...props({ onRestore: restore, onShowDetails: details })} />)
    fireEvent.click(screen.getByRole('button', { name: 'アーカイブ 1' }))
    fireEvent.click(screen.getByRole('button', { name: '詳細' }))
    expect(details).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '戻す' }))
    expect(restore).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /このアカウントへ入る/ })).toBeNull()
  })
  it('要確認カードの更新するがその1件を渡す', () => {
    const refresh = vi.fn()
    render(<AccountBrowser {...props({ onRefresh: refresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls[0][0].id).toBe('test')
  })
  it('検索でタグ名も当たり、閲覧者の設定は押せない', () => {
    const settings = vi.fn()
    render(<AccountBrowser {...props({ onSettings: settings })} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'アカウントを検索' }), { target: { value: 'イベント' } })
    expect(screen.getByText('2025年イベント')).toBeTruthy()
    expect(screen.queryByText('渋谷店')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'アカウントを検索' }), { target: { value: '' } })
    const testCard = screen.getByText('TEST').closest('article')!
    const settingButtons = Array.from(testCard.querySelectorAll('button')).filter((button) => button.textContent === '設定')
    expect(settingButtons).toHaveLength(1)
    expect(settingButtons[0].hasAttribute('disabled')).toBe(true)
    fireEvent.click(settingButtons[0])
    expect(settings).not.toHaveBeenCalled()
  })
  it('表へ切り替えても同じ行が出る', () => {
    render(<AccountBrowser {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '表で表示' }))
    expect(screen.getAllByRole('row')).toHaveLength(6)
    expect(screen.getByText('旧キャンペーン')).toBeTruthy()
  })
})
