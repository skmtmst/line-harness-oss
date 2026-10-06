// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import ReservationsPage from './page'

/*
 * ★V8-B 予約台帳（板 `Z3FoM` 一覧・`l9NlC0` 今日・`rm92Y` 電話の予約）。
 * `<html data-theme="v8">` の下でだけ新しい台帳に切り替わり、
 * 見方が変わること・v7 では従来の台帳が出ることを実DOMで固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/restaurant-test/reservations',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
}) }))

let root: Root
let host: HTMLDivElement

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString()

const snapshot = {
  environment: 'staging_test',
  integrationPolicy: 'inbound_only',
  organization: { id: 'org-1', account_id: 'account-a', tenant_id: null, tenant_name: null, name: '然 渋谷店', status: 'active' },
  stores: [{ id: 'store-1', name: '然 渋谷店', code: 'SBY', area: '渋谷', capacity: 26, timezone: 'Asia/Tokyo', status: 'active', line_account_id: null, line_account_name: null }],
  memberships: [],
  approvals: [],
  reservations: [
    {
      id: 'rsv-1', store_id: 'store-1', store_name: '然 渋谷店', source: 'line', external_id: null,
      customer_name: '佐藤 花子', customer_phone: '090-1111-2222', line_uid: 'U-1', guest_count: 2,
      starts_at: hoursFromNow(2), ends_at: hoursFromNow(4), table_id: 'tbl-1', table_label: 'T1・窓側2名卓',
      course_id: 'menu-1', course_name: 'おまかせコース', status: 'confirmed', allergy_note: null, note: null,
      sync_direction: 'inbound_only',
    },
  ],
  reservationTotal: 1,
  tables: [
    { id: 'tbl-1', store_id: 'store-1', code: 'T1', label: '窓側2名卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 0, floor_y: 0, join_group: null, is_active: 1 },
    { id: 'tbl-3', store_id: 'store-1', code: 'T3', label: '中央4名卓', seat_type: 'table', min_capacity: 2, max_capacity: 4, floor_x: 0, floor_y: 0, join_group: null, is_active: 1 },
  ],
  inventory: [],
  menuItems: [
    { id: 'menu-1', store_id: 'store-1', kind: 'course', name: 'おまかせコース', price: 8800, tax_mode: 'inclusive', allergens_json: '[]', service_periods_json: '["dinner"]', duration_minutes: 120, status: 'active' },
  ],
  connectors: [],
  reviews: [],
  posts: [],
  lineFlows: [],
}

const json = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (url: string) => json({ success: true, data: String(url).includes('/reservations/day') ? { date: '2026-10-04', reservations: snapshot.reservations } : snapshot }))
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

async function renderPage() {
  await act(async () => {
    root.render(<ReservationsPage />)
  })
  await act(async () => {})
}

function text() {
  return host.textContent || ''
}

function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((element) => (element.textContent || '').includes(label))
  if (!button) throw new Error(`ボタンが無い: ${label}`)
  act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

test('v8 では今日（時間×卓）が出て、表の列と操作は出ない', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  expect(text()).toContain('予約台帳')
  expect(text()).toContain('時間と卓で確認します')
  expect(host.querySelector('[aria-label$="時間×卓"]')).not.toBeNull()
  expect(text()).toContain('電話の予約を入れる')
  expect(host.querySelector('[data-design-node="l9NlC0"]')).not.toBeNull()
})

test('v8 の一覧に切り替えると予約タイムラインと顧客カルテが出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  click('一覧')
  await act(async () => {})
  expect(text()).toContain('予約タイムライン')
  expect(text()).toContain('佐藤 花子')
  expect(text()).toContain('顧客カルテ')
  expect(host.querySelector('[data-design-node="Z3FoM"]')).not.toBeNull()
})

test('v8 の電話の予約は rm92Y の手順と主ボタンが出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  click('電話の予約を入れる')
  await act(async () => {})
  expect(text()).toContain('だれの予約ですか')
  expect(text()).toContain('いつ・何人・どの卓')
  expect(text()).toContain('台帳に入れる')
  expect(host.querySelector('[data-design-node="rm92Y"]')).not.toBeNull()
})

test('v7 では従来の台帳が出て V8 の板は出ない', async () => {
  await renderPage()
  expect(text()).toContain('今後の予約')
  expect(host.querySelector('[data-design-node="l9NlC0"]')).toBeNull()
  expect(host.querySelector('[data-design-node="Z3FoM"]')).toBeNull()
})

test('V8の枠だけ押さえる操作は有効で、期限を入力できる', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  click('枠を押さえる')
  await act(async () => {})
  expect(host.querySelector('[aria-label="仮押さえの期限（分）"]')).not.toBeNull()
  const option = host.querySelector('input[value="hold"]') as HTMLInputElement
  expect(option?.disabled).toBe(false)
})
