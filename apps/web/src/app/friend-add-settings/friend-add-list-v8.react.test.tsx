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
 * ★V8 友だち追加時の配信の一覧（Pencil `MRhef`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい一覧に切り替わり、
 * 見本が決めた帯・受け皿の守り（消せない・動かせない・止められない確かめ）
 * が出ることを実DOMで固定する。v7 では従来の一覧が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/friend-add-settings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))

let staffRole = 'admin'
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => staffRole }
})

let root: Root
let host: HTMLDivElement
let lastListUrl: URL | null = null
let handler: (url: URL, init?: { method?: string; body?: string }) => Promise<Response> | Response
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

const baseRule = {
  id: 'rule-shop',
  accountId: 'account-a',
  friendKind: 'first_time',
  name: '店頭QRの初回案内',
  folderName: '店頭',
  priority: 1,
  isFallback: false,
  status: 'published',
  versionId: 'rule-shop-v1',
  versionNumber: 1,
  versionStatus: 'published',
  version: 1,
  lastTestStatus: 'succeeded',
  lastTestedAt: null,
  publishedAt: null,
  matchedLast7Days: 41,
  definition: {
    routeIds: ['route-shop'],
    scenarioId: 'scenario-welcome',
    messageType: 'text',
    messageText: '来店クーポンをご案内します。',
    timing: 'immediate',
    actions: [{ type: 'add_tag', label: 'タグ「新規友だち」を付ける', targetId: 'tag-new' }],
    friendCondition: null,
    activeFrom: null,
    activeUntil: null,
    weekdays: [1, 2, 3, 4, 5, 6, 0],
    timeWindows: [],
    resendSuppressionHours: 24,
    deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
    unknownRouteAction: { sendCommonGuidance: true, notifyStaff: false },
  },
  routeNames: ['店頭QRコード'],
  scenarioName: '新規登録7日間フォロー',
}

const fallbackRule = {
  ...baseRule,
  id: 'rule-fallback',
  name: '経路が分からなかった人',
  folderName: null,
  priority: 999999,
  isFallback: true,
  matchedLast7Days: 12,
  routeNames: [],
  definition: { ...baseRule.definition, routeIds: [], messageText: '友だち追加ありがとうございます。' },
}

const listData = {
  items: [baseRule, fallbackRule],
  total: 2,
  nextCursor: null,
  folderCounts: [{ name: '店頭', count: 1 }, { name: null, count: 1 }],
  summary: { rules: 2, active: 1, recentAdds: 86, captured: 74, unknownRoute: 12, delivered: 84, failed: 2 },
  options: {
    routes: [{ id: 'route-shop', name: '店頭QRコード', kind: 'QR' }],
    scenarios: [{ id: 'scenario-welcome', name: '新規登録7日間フォロー' }],
    tags: [{ id: 'tag-new', name: '新規友だち' }],
    folders: [{ id: 'f-1', name: '店頭' }],
  },
}

function base(url: URL) {
  if (url.pathname === '/api/staff/me') return response({ success: true, data: { role: staffRole } })
  if (url.pathname === '/api/friend-add-rules') {
    lastListUrl = url
    return response({ success: true, data: listData })
  }
  return response({ success: true, data: {} })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 3000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

beforeEach(() => {
  staffRole = 'admin'
  handler = base
  lastListUrl = null
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
    return handler(url)
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

test('v8 の下では Pencil MRhef の新しい一覧に切り替わる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="MRhef"]')).toBeTruthy()
  })
  // 見本が決めた帯と見出し
  expect(host.textContent).toContain('初回案内を作る')
  expect(host.textContent).toContain('はじめて友だち追加した人')
  expect(host.textContent).toContain('以前からの友だち・ブロック解除した人')
  expect(host.textContent).toContain('初回案内')
  expect(host.textContent).toContain('直近7日の友だち追加')
  expect(host.textContent).toContain('直近7日の送信')
  expect(host.textContent).toContain('経路が分からなかった人')
  // 経路の注記（板の太字）
  expect(host.textContent).toContain('流入リンク')
  // 行の中身
  expect(host.textContent).toContain('店頭QRの初回案内')
  expect(host.textContent).toContain('店頭QRコード')
  expect(host.textContent).toContain('常に有効')
})

test('v8 では検索とフォルダ・状態の絞り込みをサーバへ渡す', async () => {
  document.documentElement.dataset.theme = 'v8'
  handler = (url) => {
    if (url.pathname === '/api/friend-add-rules') {
      lastListUrl = url
      return response({ success: true, data: { ...listData, items: [], total: 0 } })
    }
    return base(url)
  }
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="MRhef"]')).toBeTruthy()
  })
  const input = host.querySelector('input[aria-label="設定名・流入リンクで探す"]') as HTMLInputElement
  expect(input).toBeTruthy()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '店頭')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 350))
  })
  await eventually(() => {
    expect(lastListUrl?.searchParams.get('q')).toBe('店頭')
  })
})

test('v8 の受け皿は一番下・操作に「削除する」がなく消せない注記が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="MRhef"]')).toBeTruthy()
  })
  const rows = [...host.querySelectorAll('tbody tr')]
  expect(rows.length).toBe(2)
  // 受け皿はいちばん下
  expect(rows[1].textContent).toContain('経路が分からなかった人')
  const trigger = [...rows[1].querySelectorAll('button')]
    .find((item) => item.getAttribute('aria-label') === '設定「経路が分からなかった人」の操作')
  expect(trigger).toBeTruthy()
  await act(async () => { trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await eventually(() => {
    const menu = document.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    const labels = [...menu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())
    expect(labels).toContain('編集する')
    expect(labels).toContain('実行結果を見る')
    expect(labels).toContain('テストを送る')
    expect(labels).toContain('一時停止する')
    expect(labels).not.toContain('削除する')
    expect(menu!.textContent).toContain('この設定は消せません')
  })
})

test('v8 の受け皿を止める選択は「止められない」確かめの小窓を出す', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="MRhef"]')).toBeTruthy()
  })
  const rows = [...host.querySelectorAll('tbody tr')]
  const trigger = [...rows[1].querySelectorAll('button')]
    .find((item) => item.getAttribute('aria-label') === '設定「経路が分からなかった人」の操作')
  await act(async () => { trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await eventually(() => {
    expect(document.querySelector('[role="menu"]')).toBeTruthy()
  })
  const stop = [...document.querySelectorAll('[role="menuitem"]')]
    .find((item) => item.textContent?.includes('一時停止する')) as HTMLElement
  await act(async () => { stop.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await eventually(() => {
    // 板 cFo2p：止められない確かめ
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
    expect(dialog?.textContent).toContain('止められません')
    expect(dialog?.textContent).toContain('12人')
  })
})

test('v8 の閲覧のみは作る操作を押せない形にする（隠さない）', async () => {
  staffRole = 'staff'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="MRhef"]')).toBeTruthy()
  })
  const create = [...host.querySelectorAll('button')]
    .find((item) => item.textContent?.includes('初回案内を作る'))
  expect(create).toBeTruthy()
  expect(create!.disabled).toBe(true)
})

test('v7 の下では従来の一覧が出る（新しい一覧には切り替わらない）', async () => {
  await act(async () => root.render(<FriendAddSettingsPage />))
  await settle()
  await eventually(() => {
    expect(host.textContent).toContain('店頭QRの初回案内')
  })
  expect(host.querySelector('[data-design-node="MRhef"]')).toBeNull()
})
