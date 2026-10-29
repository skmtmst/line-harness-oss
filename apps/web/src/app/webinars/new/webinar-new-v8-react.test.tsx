// @vitest-environment happy-dom
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
import { fireEvent } from '@testing-library/react'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/* 現役の作成入口から、同じ操作を確かめる。 */
import NewWebinarPage from './page'

/*
 * ★V8-B ウェビナー①基本設定（作る）（板 ）の契約。
 * V8 の作る画面に統一し、
 * 5段の帯・開催形式・見え方・下の帯が出ることを実DOMで固定する。
 */
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webinars/new',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
}) }))

let root: Root
let host: HTMLDivElement

const json = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

beforeEach(() => {
  forgetStaffIdentity(); rememberStaffIdentity({ role: 'owner' } as StaffMember)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/folders')) return json({ success: true, data: [] })
    return json({ data: null }, 404)
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

async function renderPage() {
  await act(async () => {
    root.render(<NewWebinarPage />)
  })
  await act(async () => {})
}

test('v8 では j7PP04 の作る画面（5段の帯・開催形式・見え方）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="j7PP04"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('ウェビナーを作る')
  expect(board?.textContent).toContain('基本設定')
  expect(board?.textContent).toContain('オンデマンド配信')
  expect(board?.querySelector('[data-template-region="content"]')?.closest('[data-page-template="create"]')).toBe(board)
  expect(board?.querySelector('[data-template-region="content"]')?.textContent).toContain('オンデマンド配信')
  expect(board?.textContent).toContain('日時指定配信')
  expect(board?.querySelector('[data-template-region="preview"]')?.textContent).toContain('▶ 申込はこちら')
  expect(board?.textContent).toContain('動画の設定へ')
})

test('名前と案内文を入れると保存前に下見へ映り、消すと空の案内へ戻る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const title = host.querySelector('#webinar-new-title') as HTMLInputElement
  const description = host.querySelector('#webinar-new-description') as HTMLInputElement
  await act(async () => {
    fireEvent.change(title, { target: { value: '新商品の説明会' } })
    fireEvent.change(description, { target: { value: '使い方を一緒に確認します' } })
  })
  const preview = () => host.querySelector('[data-template-region="preview"]')?.textContent
  expect(preview()).toContain('新商品の説明会')
  expect(preview()).toContain('使い方を一緒に確認します')
  expect(preview()).not.toContain('（ウェビナー名）')
  await act(async () => { fireEvent.change(title, { target: { value: '' } }) })
  expect(preview()).toContain('（ウェビナー名）')
})
