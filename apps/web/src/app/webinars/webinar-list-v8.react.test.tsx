// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// apiクライアントは起動時にAPI URLを要求する。実通信はfetch差替で止める。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import WebinarsPage from './page'
import type { WebinarListItem } from '@/lib/api'

/*
 * ★V8-B ウェビナー一覧（板 `UyUMw`・状態 `eAQ3t`・閲覧のみ `jiNg0`）の契約。
 * V8だけの一覧で、
 * 見本が決めた帯・表・札・押せない形が出ることを実DOMで固定する。
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webinars',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false,
}) }))

let staffRole: string | null = 'admin'
vi.mock('@/lib/staff-role', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staff-role')>()
  return { ...original, useStaffRole: () => staffRole }
})

let root: Root
let host: HTMLDivElement

const available = (value: number) => ({ value, state: 'available' as const, reason: null })
const unavailable = (reason: string) => ({ value: null, state: 'unavailable' as const, reason })

const overviewData = {
  state: 'partial',
  registrationMode: 'people',
  metrics: {
    webinars: available(6),
    activeWebinars: available(3),
    registrations: available(248),
    registrationBookings: available(260),
    viewers: unavailable('実際に見た区間の記録をまだ集計できないため'),
    viewRate: unavailable('視聴人数を取得できないため'),
    averageWatchSeconds: unavailable('集計できないため'),
    ctaUniquePeople: available(23),
    ctaTotalClicks: available(41),
  },
}

function webinar(overrides: Partial<WebinarListItem> = {}): WebinarListItem {
  return {
    id: 'webinar-1',
    accountId: 'account-a',
    title: 'NEN活用スタートセミナー',
    slug: 'nen-start',
    status: 'active',
    videoPrefix: 'videos/nen-start',
    durationSeconds: 872,
    schedule: [],
    cta: null,
    tagOnAttend: null,
    tagOnCtaClick: null,
    folderId: null,
    folderName: null,
    registrationCount: 124,
    viewerCount: 98,
    publicationState: 'always',
    publicationStartsAt: null,
    publicationEndsAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

let listItems: WebinarListItem[] = [webinar()]

const json = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

beforeEach(() => {
  listItems = [webinar()]
  staffRole = 'admin'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/overview')) return json({ data: overviewData })
    if (url.includes('/folders')) return json({ success: true, data: [] })
    if (url.includes('/api/webinars')) {
      return json({ data: { items: listItems, total: listItems.length, limit: 20, sort: [] } })
    }
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
    root.render(<WebinarsPage />)
  })
  // 取り直しの非同期が落ち着くまで1回譲る。
  await act(async () => {})
}

test('v8 では UyUMw の一覧（帯・表・視聴の2行）が出る', async () => {
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="UyUMw"]')
  expect(board).not.toBeNull()
  expect(board?.textContent).toContain('ウェビナー')
  // 数の帯：口にある数だけ出す（申込 248人・CTA 41回。視聴は未集計で—）。
  expect(board?.textContent).toContain('248')
  expect(board?.textContent).toContain('41')
  // 表の見出しと行：状態の札・視聴の2行・公開期間。
  expect(board?.textContent).toContain('視聴開始 98人')
  expect(board?.textContent).toContain('視聴完了 —')
  expect(board?.textContent).toContain('公開中')
  expect(board?.textContent).toContain('編集')
})

test('v8 の公開予定・終了の札が出る', async () => {
  listItems = [
    webinar({ id: 'w-future', title: 'EC連携実践講座', publicationState: 'scheduled' }),
    webinar({ id: 'w-ended', title: '旧機能説明会', publicationState: 'ended' }),
  ]
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="UyUMw"]')
  expect(board?.textContent).toContain('公開予定')
  expect(board?.textContent).toContain('終了')
})

test('v8 で何も無いときは eAQ3t の「まだ無い」が出る', async () => {
  listItems = []
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="UyUMw"]')
  expect(board?.textContent).toContain('まだ、ウェビナーはありません')
})

test('v8 の閲覧のみ（jiNg0）は作る・編集が押せない形になる', async () => {
  staffRole = 'staff'
  document.documentElement.dataset.theme = 'v8'
  await renderPage()
  const board = host.querySelector('[data-design-node="UyUMw"]')
  expect(board).not.toBeNull()
  const createButton = [...board!.querySelectorAll('button')].find((button) => button.textContent?.includes('ウェビナーを作る'))
  expect(createButton?.disabled).toBe(true)
  const editButton = [...board!.querySelectorAll('button')].find((button) => button.textContent === '編集')
  expect(editButton?.disabled).toBe(true)
  expect(board?.textContent).toContain('閲覧のみで見ています')
})

test('v8 の読み込み中は骨組みで場所を取り「読み込み中」の文字は出さない', async () => {
  vi.stubGlobal('fetch', () => new Promise<Response>(() => {}))
  document.documentElement.dataset.theme = 'v8'
  await act(async () => {
    root.render(<WebinarsPage />)
  })
  // 場所取り：読み上げは1回だけ、骨組みに読み上げは付けない。
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(host.textContent).toContain('ウェビナーの一覧を読み込んでいます')
  expect(host.textContent).not.toContain('読み込み中')
  // 0.3秒たつと骨組みの5行が出る（見出し＋行の高さは本物と同じ）。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })
  const skeletons = host.querySelectorAll('[data-skeleton]')
  expect(skeletons.length).toBeGreaterThanOrEqual(5)
})

test('アーカイブ済みを開いて記録を読み、確認してから下書きへ戻せる', async () => {
  const archived = webinar({ status: 'archived', publicationState: 'ended' })
  const requests: Array<{ url: string; method: string; body?: string }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
    if (url.includes('/overview')) return json({ data: overviewData })
    if (url.includes('/folders')) return json({ success: true, data: [] })
    if (init?.method === 'PUT') return json({ data: { ...archived, status: 'draft' } })
    if (url.includes('/api/webinars')) {
      const params = new URL(url).searchParams
      const items = params.get('status') === 'archived' ? [archived] : []
      return json({ data: { items, total: items.length, limit: 20, sort: [] } })
    }
    return json({ data: null }, 404)
  })
  await renderPage()
  await act(async () => { (host.querySelector('button[aria-label="よく使う絞り込み"]') as HTMLButtonElement).click() })
  const option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === 'アーカイブ済み') as HTMLElement
  expect(option).toBeTruthy()
  await act(async () => { option.querySelector('button')!.click() })
  expect(requests.some((r) => r.url.includes('status=archived'))).toBe(true)
  const row = host.querySelector('tbody tr')!
  expect(row.textContent).toContain('● アーカイブ')
  expect(row.textContent).toContain('124人')
  expect(row.textContent).toContain('視聴開始 98人')
  await act(async () => { (row.querySelector('button[aria-label="NEN活用スタートセミナーのその他操作"]') as HTMLButtonElement).click() })
  const restore = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('下書きに戻す')) as HTMLElement
  await act(async () => { restore.click() })
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0)
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('公開するまでは、新しい申込は受け付けません')
  await act(async () => { ([...dialog.querySelectorAll('button')].find((el) => el.textContent === '下書きに戻す') as HTMLButtonElement).click() })
  expect(requests.filter((r) => r.method === 'PUT').map((r) => JSON.parse(r.body!))).toEqual([{ status: 'draft' }])
})
