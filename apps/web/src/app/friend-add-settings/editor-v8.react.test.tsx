// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import FriendAddSettingsPage from './page'

/*
 * ★V8 友だち追加時の配信を作る手順（板 `wDzkc`・`h8uNW`・`al47K`・
 * `i1nThZ`・`U8Xm3X`）の契約。`<html data-theme="v8">` の下でだけ
 * 新しい作る手順に切り替わり、手順の輪・右の「設定内容」・下の帯が
 * 出ることを実DOMで固定する。v7 では従来の編集器が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/friend-add-settings',
  useSearchParams: () => new URLSearchParams('view=new&step=basic'),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false, accounts: [{ id: 'account-a' }],
}) }))
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => 'admin' }
})

let root: Root
let host: HTMLDivElement
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

const listData = {
  items: [],
  total: 0,
  nextCursor: null,
  folderCounts: [],
  summary: { rules: 0, active: 0, recentAdds: 0, captured: 0, unknownRoute: 0, delivered: 0, failed: 0 },
  options: {
    routes: [{ id: 'route-shop', name: '店頭QRコード', kind: 'QR' }],
    scenarios: [{ id: 'scenario-welcome', name: '新規登録7日間フォロー' }],
    tags: [{ id: 'tag-new', name: '新規友だち' }],
    folders: [{ id: 'f-1', name: '店頭' }],
  },
}

function base(url: URL) {
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: 'admin' } })
  if (url.pathname === '/api/friend-add-rules') return response({ success: true, data: listData })
  if (url.pathname === '/api/friend-add-rules/conflicts') return response({ success: true, data: { rules: [], conflicts: [] } })
  return response({ success: true, data: {} })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return base(url)
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

test('v8 の作る①は板 wDzkc・手順の輪・設定内容・下の帯が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="wDzkc"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('初回案内を作る')
  expect(host.textContent).toContain('設定内容')
  expect(host.textContent).toContain('下書きを保存')
  expect(host.textContent).toContain('次へ：流入リンク')
  expect(host.textContent).toContain('だれに送るか')
})

test('v7 の下では従来の編集器が出る（作る①には切り替わらない）', async () => {
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.textContent).toContain('基本設定')
  })
  expect(host.querySelector('[data-design-node="wDzkc"]')).toBeNull()
})
