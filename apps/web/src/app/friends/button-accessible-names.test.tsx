// @vitest-environment happy-dom
/*
 * Issue #637（監査 D-3「無名ボタン」03番 /friends）の回帰固定。
 *
 * 監査時点では一覧の操作ボタン5件に名前が無かった。現行コードは
 * 注目ボタン（aria-label「○○の注目を付ける」など）を含め、全ボタンが
 * 可視テキストか aria-label を持つ。このテストは無名ボタンが
 * 戻らないことを固定する。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buttonsWithoutAccessibleName } from '@/test-utils/accessible-name'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) => <a href={href}>{children as never}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/friends',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', role: 'owner', displayName: 'A店' },
    loading: false,
  }),
}))

import FriendsPage from './page'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function installFetch() {
  const friends = Array.from({ length: 5 }, (_, i) => ({
    id: `friend-${i}`,
    displayName: `テスト友だち${i}`,
    userId: `U${i}`,
    isBlocked: false,
    tags: [],
    createdAt: '2026-09-01T00:00:00Z',
    followedAt: '2026-09-01T00:00:00Z',
  }))
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    const bare = path.split('?')[0]
    if (bare === '/api/settings/features/visibility') {
      return json({ success: true, data: { features: { support_marks: true, saved_searches: true, friend_fields: true } } })
    }
    if (bare === '/api/scenarios') return json({ success: true, data: { items: [], total: 0, limit: 200, sort: [] } })
    if (bare === '/api/tags' || bare === '/api/operators' || bare === '/api/support-marks') {
      return json({ success: true, data: [] })
    }
    if (bare === '/api/friends') return json({ success: true, data: { items: friends, total: 5 } })
    return json({ success: true, data: null })
  })
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  installFetch()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('Issue #637 /friends 全ボタンにアクセシブルな名前', () => {
  it('一覧の操作・ページングを含め無名ボタンがない', async () => {
    await act(async () => { root.render(<FriendsPage />) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)) })

    const unnamed = buttonsWithoutAccessibleName(host)
    expect(
      unnamed.map((b) => b.outerHTML.slice(0, 160)),
      '無名ボタンが残っている',
    ).toEqual([])
  })
})
