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

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    webinarApi: {
      ...actual.webinarApi,
      get,
      editor,
      analytics,
      publishValidation: vi.fn(() => new Promise(() => {})),
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('id=w1'),
  usePathname: () => '/webinars/edit',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

vi.mock('@/lib/use-unsaved-guard', () => ({
  useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: () => {}, cancelLeave: () => {}, disarm: () => {} }),
}))

vi.mock('@/components/webinars/webinar-form', () => ({
  default: () => null,
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

    const nav = host.querySelector('nav[aria-label="参加者・分析・演出へ移動"]')
    expect(nav, '常設導線の nav が見つかりません').toBeTruthy()
    expect(nav!.textContent).toContain('参加者')
    expect(nav!.textContent).toContain('分析')
    expect(nav!.textContent).toContain('コメント演出')
  })

  it('分析を押すと分析の段へ切り替わる', async () => {
    await act(async () => { root.render(<EditWebinarPage />) })
    await flush()

    const nav = host.querySelector('nav[aria-label="参加者・分析・演出へ移動"]')!
    const button = [...nav.querySelectorAll('button')].find((el) => el.textContent === '分析')
    expect(button, '分析の行き先が見つかりません').toBeTruthy()
    await act(async () => { button!.click() })
    await flush()
    expect(button!.getAttribute('aria-current')).toBe('page')
  })
})
