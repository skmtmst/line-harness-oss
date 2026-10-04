// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import ConversionsPage from './page'

/*
 * ★V8-B コンバージョンの一覧（Pencil `r6dJFy`・状態 `E2l8cw`・
 * 1152 `BygrU`・閲覧のみ `WSGvo`）の契約。
 * `<html data-theme="v8">` の下でだけ新しい一覧に切り替わり、
 * 見本が決めた見出し・数の帯・表の列・表の下の小窓が出ることを
 * 実DOMで固定する。v7 では従来の一覧が出ることも固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/conversions',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, loading: false,
}) }))

let staffRole = 'admin'
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>() as Record<string, unknown>
  return { ...original, useStaffRole: () => staffRole }
})

let root: Root
let host: HTMLDivElement
let posted: string[] = []
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

const pointActive = {
  id: 'cv-buy',
  name: '商品を買った',
  sourceType: 'ec_order_confirmed',
  value: null,
  measureMethod: 'webhook',
  targetUrl: null,
  countRepeat: true,
  attributionDays: 90,
  sourceConfig: {},
  deduplicationMode: 'every',
  deduplicationWindowDays: null,
  valueMode: 'source',
  reversalPolicy: 'source_cancelled',
  lineAccountId: 'account-a',
  status: 'active',
  state: 'active',
  stateReason: null,
  ingest: { configured: true, disabledAt: null },
  version: 3,
  usageCount: 2,
  usageNames: ['ファネル2', 'アフィリエイト1'],
  metrics: {
    recordedCount: 55, netCount: 52, reversedCount: 3, reversedValue: 9000,
    netValue: 412000, reversalState: 'available', reversalReason: '純額定義',
    cancellationCount: 0, cancellationValue: 0,
  },
  stoppedAt: null,
  createdAt: '2026-08-01T00:00:00+09:00',
  updatedAt: '2026-09-20T00:00:00+09:00',
}

const pointStopped = {
  ...pointActive,
  id: 'cv-doc',
  name: '資料をダウンロードした',
  sourceType: 'url_reach',
  measureMethod: 'url_reach',
  targetUrl: 'https://example.com/doc',
  deduplicationMode: 'once_per_friend',
  valueMode: 'none',
  status: 'stopped',
  state: 'stopped',
  ingest: { configured: false, disabledAt: null },
  usageCount: 0,
  usageNames: [],
  metrics: {
    recordedCount: 0, netCount: 0, reversedCount: 0, reversedValue: 0,
    netValue: 0, reversalState: 'available', reversalReason: '純額定義',
    cancellationCount: 0, cancellationValue: 0,
  },
  stoppedAt: '2026-09-20T10:00:00+09:00',
}

const listPayload = {
  items: [pointActive, pointStopped],
  stateCounts: { active: 1, draft: 0, stopped: 1, invalid: 0, sourceStopped: 0, unused: 1 },
  range: { from: '2026-09-03', to: '2026-10-02', timeZone: 'Asia/Tokyo' },
  pagination: { total: 2, limit: 100, cursor: '', nextCursor: null },
}

const reportPayload = {
  range: { from: '2026-09-03', to: '2026-10-02', timeZone: 'Asia/Tokyo' },
  previousRange: { from: '2026-08-04', to: '2026-09-02', timeZone: 'Asia/Tokyo' },
  kpis: {
    recordedCount: 55, recordedValue: 421000, reversedCount: 3,
    netCount: 52, netValue: 412000, averageNetValue: 7923,
    previousNetCount: 31, previousNetValue: 200000, countChangeRate: 68,
  },
  byDefinition: [], daily: [], byRoute: [],
}

function base(url: URL, init?: { method?: string }) {
  if (url.pathname === '/api/conversions/definitions') {
    return response({ success: true, data: listPayload })
  }
  if (url.pathname === '/api/conversions/report') {
    return response({ success: true, data: reportPayload })
  }
  if (url.pathname === '/api/staff/me') {
    return response({ success: true, data: { id: 'staff-1', role: staffRole } })
  }
  if (url.pathname === '/api/conversions/definitions/cv-buy/delete-impact') {
    return response({
      success: true,
      data: {
        definition: { version: 3 },
        usages: [{ id: 'u-1', usageName: 'ファネル2' }],
        eventCount: 52,
        canDelete: false,
        stopImpact: { affectedUsageCount: 1, preservesPastEvents: true, preservesUsages: true },
        replacementCandidates: [{ id: 'cv-doc', name: '資料をダウンロードした', version: 1 }],
      },
    })
  }
  if (url.pathname === '/api/conversions/definitions/cv-buy/stop' && init?.method === 'POST') {
    posted.push(url.pathname)
    return response({ success: true, data: { id: 'cv-buy', status: 'stopped', version: 4, stoppedAt: '2026-10-03T00:00:00+09:00' } })
  }
  return response({ success: false, error: 'not mocked', data: null })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function eventually(check: () => void, timeout = 8000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

function typeInto(input: HTMLInputElement, value: string) {
  input.focus()
  // React の onChange に届くよう native setter で入れる。
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  staffRole = 'admin'
  posted = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return base(url, { method: init?.method })
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

test('v8 の下では Pencil r6dJFy の新しい一覧に切り替わる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<ConversionsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="r6dJFy"]')).toBeTruthy()
  })
  // 見出しと右のボタン
  expect(host.textContent).toContain('コンバージョン')
  expect(host.textContent).toContain('CSVで書き出す')
  // 数の帯は表の行の合計（52件・¥412,000）と一致する
  expect(host.textContent).toContain('この30日の成果')
  expect(host.textContent).toContain('52')
  expect(host.textContent).toContain('¥412,000')
  expect(host.textContent).toContain('どこからも使われていない')
  // 行の中身（名前・状態・数・金額・使う場所・操作）
  expect(host.textContent).toContain('商品を買った')
  expect(host.textContent).toContain('動いている')
  expect(host.textContent).toContain('止めている')
  expect(host.textContent).toContain('使う場所を足す')
})

test('v8 で行を選ぶと詳細の小窓が出て、止める小窓は理由必須で止める', async () => {
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<ConversionsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="r6dJFy"]')).toBeTruthy()
  })
  // 行の名前を押すと詳細の小窓が出る
  const nameButton = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('商品を買った'))
  expect(nameButton).toBeTruthy()
  await act(async () => { nameButton!.click() })
  await eventually(() => {
    expect(host.textContent).toContain('詳細の小窓：商品を買った')
  })
  expect(host.textContent).toContain('鍵を発行する')
  // 小窓の「止める」で止める小窓が出る
  const stopButton = [...host.querySelectorAll('button')].find((button) =>
    button.textContent === '止める')
  expect(stopButton).toBeTruthy()
  await act(async () => { stopButton!.click() })
  await eventually(() => {
    expect(host.textContent).toContain('「商品を買った」を止める')
  })
  expect(host.textContent).toContain('理由（必須）')
  // 理由が空のままは止められない（詳細の小窓の「止める」と区別する）
  const stopPanel = host.querySelector('section[aria-label="止めるときの小窓"]')
  expect(stopPanel).toBeTruthy()
  const confirmButton = [...stopPanel!.querySelectorAll('button')].find((button) =>
    button.textContent === '止める')
  expect(confirmButton?.hasAttribute('disabled')).toBe(true)
  const reason = host.querySelector('input[aria-label="止める理由"]') as HTMLInputElement
  expect(reason).toBeTruthy()
  await act(async () => { typeInto(reason, '計測の仕方を変えるため') })
  await eventually(() => {
    expect(confirmButton?.hasAttribute('disabled')).toBe(false)
  })
  await act(async () => { confirmButton!.click() })
  await eventually(() => {
    expect(posted).toContain('/api/conversions/definitions/cv-buy/stop')
  })
})

test('v8 の閲覧のみでは帯が出て作る操作が押せない形になる', async () => {
  staffRole = 'viewer'
  document.documentElement.dataset.theme = 'v8'
  await act(async () => root.render(<ConversionsPage />))
  await settle()
  await eventually(() => {
    expect(host.querySelector('[data-design-node="r6dJFy"]')).toBeTruthy()
  })
  expect(host.textContent).toContain('閲覧のみで見ています')
  const createButton = host.querySelector('button[disabled][title="この操作にはオーナーか管理者の権限が要ります"]')
  expect(createButton?.textContent).toContain('成果地点を作る')
})
