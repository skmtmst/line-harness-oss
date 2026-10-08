// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'

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
const navigation = vi.hoisted(() => ({ query: 'view=new&step=basic' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/friend-add-settings',
  useSearchParams: () => new URLSearchParams(navigation.query),
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
  if (url.pathname === '/api/friend-add-rules/test-draft') return response({ success: true, data: {
    rule: {
      id: 'test-draft', name: '案内', folderName: null, priority: 1, friendKind: 'first_time',
      isFallback: false, status: 'draft', matchedLast7Days: null, lastTestStatus: null, version: 1,
      definition: { routeIds: [], scenarioId: null, messageType: 'text', messageText: 'こんにちは',
        timing: 'immediate', actions: [], friendCondition: '', activeFrom: '2026-10-01T00:00', activeUntil: '2026-11-30T23:59' },
    },
    options: listData.options,
  } })
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
  navigation.query = 'view=new&step=basic'
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
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
  vi.restoreAllMocks()
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

test('名前が空なら保存せず、理由を1回だけ出し、赤い名前欄へ移る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await eventually(() => expect(host.querySelector('#fa-name')).toBeTruthy())
  const save = [...host.querySelectorAll('button')].find((button) => button.textContent === '下書きを保存')!
  await act(async () => save.click())
  const name = host.querySelector<HTMLInputElement>('#fa-name')!
  await eventually(() => expect(document.activeElement).toBe(name))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
  expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBe('設定名を入力してください。')
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  await act(async () => fireEvent.change(name, { target: { value: '初回案内' } }))
  expect(name.getAttribute('aria-invalid')).toBeNull()
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

test('流入リンクが未選択なら次へ進まず、選択欄と理由をつなぎ、最初の選択欄へ移る', async () => {
  navigation.query = 'view=edit&id=test-draft&step=routes'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await eventually(() => expect(host.querySelector('[data-friend-add-routes] input[type="checkbox"]')).toBeTruthy())
  const search = host.querySelector<HTMLInputElement>('input[aria-label="流入リンクの名前で探す"]')!
  const next = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('次へ：初回案内'))!
  await act(async () => next.click())
  const checkbox = host.querySelector<HTMLInputElement>('[data-friend-add-routes] input[type="checkbox"]')!
  await eventually(() => expect(document.activeElement).toBe(checkbox))
  expect(checkbox.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(checkbox.getAttribute('aria-describedby')!)?.textContent).toBe('対象にする流入リンクを1つ以上選んでください。')
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
  expect(search.getAttribute('aria-invalid')).toBeNull()
  await act(async () => checkbox.click())
  expect(checkbox.getAttribute('aria-invalid')).toBeNull()
})

test('シナリオが未選択なら選べる赤い欄へ移り、選ぶと誤りを消す', async () => {
  navigation.query = 'view=edit&id=test-draft&step=message'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await eventually(() => expect(host.querySelector('[aria-label="最初に送るメッセージ"]')).toBeTruthy())
  const next = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('次へ：あわせて行うこと'))!
  await act(async () => next.click())
  await eventually(() => expect(document.activeElement?.id).toBe('fa-scenario'))
  const select = host.querySelector<HTMLButtonElement>('#fa-scenario')!
  expect(select.getAttribute('aria-invalid')).toBe('true')
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
  await act(async () => select.click())
  const option = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent === '新規登録7日間フォロー')!
  await act(async () => option.querySelector<HTMLButtonElement>('button')!.click())
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

test('未入力のまま次へを押しても、名前欄へ移り、保存・画面移動はしない', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await eventually(() => expect(host.querySelector('#fa-name')).toBeTruthy())
  const next = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('次へ：流入リンク'))!
  await act(async () => next.click())
  await eventually(() => expect(document.activeElement?.id).toBe('fa-name'))
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  expect(host.querySelector('[data-friend-add-routes]')).toBeNull()
})


test('狭い画面の条件編集は小窓で開き、変更した期間を閉じたあとも保存する', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 1280px)', media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
  }))
  navigation.query = 'view=edit&id=test-draft&step=routes'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await eventually(() => expect(host.querySelector('[data-friend-add-routes]')).toBeTruthy())
  expect(host.querySelector('#fa-from')).toBeNull()
  const open = [...host.querySelectorAll('button')].find((button) => button.textContent === '対象をしぼる（任意）')!
  await act(async () => open.click())
  await eventually(() => expect(document.querySelector('[role="dialog"] #fa-from')).toBeTruthy())
  const dialog = document.querySelector('[role="dialog"]')!
  const clear = dialog.querySelector<HTMLButtonElement>('[aria-label="日時を消す"]')!
  await act(async () => clear.click())
  expect(dialog.querySelector('#fa-from')?.textContent).toBe('日時を選ぶ')
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="閉じる"]')!.click())
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  const save = [...host.querySelectorAll('button')].find((button) => button.textContent === '下書きを保存')!
  await act(async () => save.click())
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')!
  const payload = JSON.parse(String(request[1]?.body))
  expect(payload.definition.activeFrom).toBeNull()
  expect(payload.definition.activeUntil).toBe('2026-11-30T23:59')
})
