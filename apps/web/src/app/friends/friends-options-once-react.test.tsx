// @vitest-environment happy-dom
/*
 * V6R-S1-b: 友だち一覧の絞り込みの選択肢は、対応マークの有効が後から分かっても取り直さない。
 *
 * 検証環境の実測では、表示可否が届いて対応マークが有効と分かった瞬間に、
 * タグ・担当者・シナリオの3本を2回目として取り直していた。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const calls: string[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const bare = path.split('?')[0]
    if (bare === '/api/settings/features/visibility') {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return json({ success: true, data: { features: { support_marks: true, saved_searches: true, friend_fields: true } } })
    }
    if (bare === '/api/scenarios') return json({ success: true, data: { items: [], total: 0, limit: 200, sort: [] } })
    if (bare === '/api/tags' || bare === '/api/operators' || bare === '/api/support-marks') {
      return json({ success: true, data: [] })
    }
    if (bare === '/api/friends') return json({ success: true, data: { items: [], total: 0 } })
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
  calls.length = 0
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

function count(bare: string): number {
  return calls.filter((call) => call.split(' ')[1]?.split('?')[0] === bare).length
}

describe('友だち一覧の選択肢は取り直さない（V6R-S1-b）', () => {
  it('対応マークが後から有効になっても、タグ・担当者・シナリオは1回ずつ', async () => {
    await act(async () => { root.render(<FriendsPage />) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)) })

    expect(count('/api/support-marks')).toBe(1)
    expect(count('/api/tags')).toBe(1)
    expect(count('/api/operators')).toBe(1)
    expect(count('/api/scenarios')).toBe(1)
  })
})
