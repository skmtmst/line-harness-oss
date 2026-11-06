// @vitest-environment happy-dom
/*
 * R94: 編集画面に 参加者・分析・コメント演出への常設導線がある。
 * 段の手順（STEPS）とは別の nav に3つの行き先が並び、押すと段が切り替わる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const get = vi.hoisted(() => vi.fn())
const editor = vi.hoisted(() => vi.fn())
const analytics = vi.hoisted(() => vi.fn())
const navFixture = vi.hoisted(() => ({ query: 'id=w1&pane=participants', role: 'owner' }))
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => navFixture.role }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    webinarApi: {
      ...actual.webinarApi,
      get,
      editor,
      analytics,
      folders: vi.fn(async () => ({ success: true, data: [] })),
      participants: vi.fn(async () => ({ data: { items: [], nextCursor: null } })),
      publishValidation: vi.fn(() => new Promise(() => {})),
    },
  }
})

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(navFixture.query),
  usePathname: () => '/webinars/edit',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', async () => ({ ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(),
  usePageTitle: () => {},
}))

vi.mock('@/lib/use-unsaved-guard', () => ({
  useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: () => {}, cancelLeave: () => {}, disarm: () => {} }),
}))


import EditWebinarPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const webinar = {
  id: 'w1',
  accountId: 'account-a',
  title: 'テストウェビナー',
  slug: 'test-webinar',
  status: 'draft',
  videoPrefix: null,
  videoMediaId: null,
  durationSeconds: 7200,
  schedule: [],
  cta: null,
  tagOnAttend: null,
  tagOnCtaClick: null,
  folderId: null,
  publicationState: 'unset',
  publicationStartsAt: null,
  publicationEndsAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const editorPayload = {
  version: 3,
  deliveryKind: 'scheduled',
  viewingCondition: { kind: 'registered', label: '申込者向け' },
  publicDescription: '',
  registrationFormId: null,
  ctaCount: 0,
  notificationMessages: {},
  notificationTest: null,
  actionPolicy: { templateBody: '', missingResultPolicy: 'escalate' },
  publicPage: {
    liffId: null, url: null, unavailableReason: 'LIFF未設定', description: '',
    test: null, form: null,
  },
  publication: { status: 'draft', draftVersion: 3, publishedVersion: null, publishedAt: null },
  monitoring: { notificationFailures: 0, duplicateRegistrations: 0, viewSegmentFailures: 0, actionFailures: 0 },
}

beforeEach(() => {
  navFixture.query = 'id=w1&pane=participants'
  navFixture.role = 'owner'
  window.history.replaceState(null, '', '/webinars/edit?id=w1')
  get.mockImplementation(async () => ({ success: true, data: webinar }))
  editor.mockImplementation(async () => ({ success: true, data: editorPayload }))
  analytics.mockImplementation(() => new Promise(() => {}))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('R94 編集画面の常設導線', () => {
  it('参加者・分析・コメント演出の行き先がいつでも選べる', async () => {
    await act(async () => { root.render(<EditWebinarPage />) })
    await flush()

    const nav = host.querySelector('[role="tablist"][aria-label="設定・参加者・分析・コメント演出"]')
    expect(nav, '常設導線の nav が見つかりません').toBeTruthy()
    expect(nav!.textContent).toContain('参加者')
    expect(nav!.textContent).toContain('分析')
    expect(nav!.textContent).toContain('コメント演出')
  })

  it('分析を押すと分析の段へ切り替わる', async () => {
    await act(async () => { root.render(<EditWebinarPage />) })
    await flush()

    const nav = host.querySelector('[role="tablist"][aria-label="設定・参加者・分析・コメント演出"]')!
    const button = [...nav.querySelectorAll('button')].find((el) => el.textContent === '分析')
    expect(button, '分析の行き先が見つかりません').toBeTruthy()
    const historyLength = window.history.length
    await act(async () => { button!.click() })
    await flush()
    expect(host.querySelector('[role="tablist"][aria-label="設定・参加者・分析・コメント演出"] [aria-current="page"]')?.textContent).toBe('分析')
    expect(window.history.length).toBe(historyLength)
  })
})

it('詳細タブから設定へ戻っても履歴を増やさない', async () => {
  await act(async () => root.render(<EditWebinarPage />))
  await flush()
  const settings = host.querySelector('[role="tablist"] [role="tab"]') as HTMLButtonElement
  const historyLength = window.history.length
  await act(async () => settings.click())
  await flush()
  expect(window.location.search).toContain('pane=basic')
  expect(window.history.length).toBe(historyLength)
})

describe('現役の設定から参加者へ移る口', () => {
  it.each(['owner', 'staff'])('%s は設定のメニューから参加者へ移れる', async (role) => {
    navFixture.role = role
    navFixture.query = 'id=w1&pane=basic'
    await act(async () => root.render(<EditWebinarPage />))
    await flush()
    const more = host.querySelector('button[aria-label="ウェビナーの操作"]') as HTMLButtonElement
    expect(more).not.toBeNull()
    await act(async () => more.click())
    const menu = document.querySelector('[role="menu"]')!
    expect(menu.textContent).toContain('参加者を見る')
    expect(menu.textContent).toContain('分析を見る')
    expect(menu.textContent).toContain('コメント演出を開く')
    if (role === 'staff') expect(menu.textContent).not.toContain('複製する')
    const participants = [...menu.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '参加者を見る') as HTMLButtonElement
    await act(async () => participants.click())
    await flush()
    expect(host.querySelector('[role="tablist"] [aria-current="page"]')?.textContent).toContain('参加者')
    expect(window.location.search).toContain('pane=participants')
  })
})
