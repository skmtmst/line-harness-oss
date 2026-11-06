// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import FriendInfoSidebarBoundary from './friend-info-sidebar-boundary'

it('相手・アカウント切替で失敗を解除し、捕捉ログには固定の印だけを渡す', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  function Broken(): never { throw new Error('顧客名 customer@example.com secret-token') }
  try {
    await act(async () => { root.render(<><p>会話と一覧</p><FriendInfoSidebarBoundary resetKey="account-a:friend-a"><Broken /></FriendInfoSidebarBoundary></>) })
    expect(host.textContent).toContain('会話と一覧')
    expect(host.textContent).toContain('顧客情報を読み込めませんでした')
    // React自身の開発ログとは分け、境界が発行するJSON1行の引数を検査する。
    const emitted = log.mock.calls.filter(args => typeof args[0] === 'string' && args[0].startsWith('{'))
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toHaveLength(1)
    expect(JSON.parse(emitted[0][0] as string)).toEqual({ timestamp: expect.any(String), level: 'error', code: 'inbox_customer_panel_failed', requestId: null, invocationId: null, source: 'admin' })
    expect(JSON.stringify(emitted)).not.toMatch(/customer@example|secret-token|顧客名/)
    await act(async () => { root.render(<><p>会話と一覧</p><FriendInfoSidebarBoundary resetKey="account-b:friend-a"><p>切替先の顧客</p></FriendInfoSidebarBoundary></>) })
    expect(host.textContent).toContain('切替先の顧客')
    expect(host.textContent).not.toContain('顧客情報を読み込めませんでした')
  } finally {
    await act(async () => root.unmount()); host.remove(); log.mockRestore()
  }
})
