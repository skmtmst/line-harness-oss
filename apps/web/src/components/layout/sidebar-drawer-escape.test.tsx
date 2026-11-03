// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 狭い画面（ハンバーガーで開く脇メニュー）の中で、左下のアカウント
 * メニューを開いて Esc を押したときの動き。
 *
 * ★本番ポートの再検証（幅1152px）で見つかった不具合の見張り。
 * 脇メニュー（`sidebar.tsx`）とアカウントメニュー（`hq/account-menu.tsx`）が
 * どちらも `document` の Escape を聞いていて、素のまま受けると
 * 脇メニューまで閉じ、焦点が上のハンバーガーへ奪われていた。
 * 文字を見張るだけの試験では見つからなかったので、ここは実際に
 * 押して確かめる。
 */

const localStorageValues = new Map<string, string>()
const testLocalStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
  removeItem: (key: string) => { localStorageValues.delete(key) },
  clear: () => { localStorageValues.clear() },
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testLocalStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage })

vi.mock('next/navigation', () => ({ usePathname: () => '/hq/members' }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
      React.createElement('a', { href, ...props }, children),
  }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: '会社', iconUrl: null }) }))
vi.mock('@/components/layout/sidebar-identity', () => ({ default: () => <div>identity</div> }))
vi.mock('@/lib/logout', () => ({ logoutAndGoToLogin: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: {
    staff: { me: vi.fn(async () => ({ success: true, data: { id: 's1', name: '坂本', email: 'a@example.com', role: 'owner' } })) },
    hqBilling: { summary: vi.fn(async () => ({ success: false })) },
    featureSettings: {
      visibility: vi.fn(async () => ({ success: true, data: {} })),
      get: vi.fn(async () => ({ success: true, data: {} })),
    },
    inbox: { unanswered: { count: vi.fn(async () => ({ success: true, data: { total: 0 } })) } },
    nenMembers: { overview: vi.fn(async () => ({ success: true, data: { pendingPhotos: 0 } })) },
    health: { summary: vi.fn(async () => ({ success: true, data: { warningCount: 0, dangerCount: 0 } })) },
  },
}))

import Sidebar from './sidebar'

const press = async (target: Element, key: string) => {
  await act(async () => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('脇メニューの中のアカウントメニューと Esc', () => {
  afterEach(() => {
    cleanup()
    localStorageValues.clear()
  })

  it('Esc はアカウントメニューだけを閉じ、脇メニューは開いたまま・焦点は押したボタンに残る', async () => {
    render(<Sidebar />)

    const hamburger = document.querySelector<HTMLButtonElement>('button[aria-label="メニュー"]')
    expect(hamburger).not.toBeNull()
    await act(async () => { hamburger!.click() })

    const drawer = document.querySelector<HTMLElement>('#mobile-menu')
    expect(drawer).not.toBeNull()
    // 開いている間は中の項目へ Tab で行ける（inert を外す）。
    expect(drawer!.hasAttribute('inert')).toBe(false)

    const trigger = drawer!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
    expect(trigger).not.toBeNull()
    await act(async () => { trigger!.click() })
    await waitFor(() => {
      expect(document.querySelector('[role="menu"][aria-label="アカウントメニュー"]')).not.toBeNull()
    })

    trigger!.focus()
    await press(trigger!, 'Escape')

    // アカウントメニューだけが閉じる。
    await waitFor(() => {
      expect(document.querySelector('[role="menu"][aria-label="アカウントメニュー"]')).toBeNull()
    })
    // 脇メニューは開いたまま。焦点は上のハンバーガーへ移らない。
    expect(drawer!.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(trigger)
    expect(document.activeElement).not.toBe(hamburger)
  })

  it('アカウントメニューを開いていないときの Esc は、これまでどおり脇メニューを閉じる', async () => {
    render(<Sidebar />)

    const hamburger = document.querySelector<HTMLButtonElement>('button[aria-label="メニュー"]')
    await act(async () => { hamburger!.click() })
    const drawer = document.querySelector<HTMLElement>('#mobile-menu')
    expect(drawer!.hasAttribute('inert')).toBe(false)

    await press(document.body, 'Escape')

    await waitFor(() => {
      expect(drawer!.hasAttribute('inert')).toBe(true)
    })
  })
})
