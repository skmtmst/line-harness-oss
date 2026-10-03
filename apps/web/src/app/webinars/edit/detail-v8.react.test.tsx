// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/*
 * ★V8-B ウェビナーの結果まわり（板 `uNsEy` 参加者・`z2dgw` 分析・`Omqd4` コメント演出）の契約。
 * タブごとに外枠の板IDが付き、参加者の表・分析のファネル・コメントの表が出ることを実DOMで固定する。
 */
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webinars/edit',
  useSearchParams: () => new URLSearchParams('id=webinar-1&pane=participants'),
}))

const participantsMock = vi.hoisted(() => ({ items: vi.fn() }))
const commentsMock = vi.hoisted(() => ({ items: vi.fn() }))

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    downloadApiFile: vi.fn(),
    webinarApi: {
      participants: participantsMock.items,
      participantsCsvUrl: (id: string) => `/api/webinars/${id}/participants.csv`,
      comments: commentsMock.items,
      saveComments: vi.fn(),
    },
  }
})

import DetailV8 from './detail-v8'

let root: Root
let host: HTMLDivElement

const webinar = {
  id: 'webinar-1',
  title: 'NEN活用スタートセミナー',
  status: 'active',
  durationSeconds: 3600,
}

const analytics = {
  summary: {
    reservations: 124,
    viewers: 100,
    registeredAndJoined: 90,
    watched5m: 80,
    watched15m: 75,
    completed: 71,
    avgWatchedSeconds: 360,
    ctaClicks: 23,
    formSubmissions: 9,
  },
  retention: { bucketSeconds: 60, started: 100, points: [] },
  ctaAtSeconds: null,
  heartbeatRejects: 0,
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  participantsMock.items.mockResolvedValue({ data: { items: [], nextCursor: null } })
  commentsMock.items.mockResolvedValue({ data: [] })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

async function renderTab(tab: 'participants' | 'analytics' | 'comments') {
  await act(async () => {
    root.render(
      <DetailV8
        webinar={webinar as never}
        deliveryKind="on_demand"
        participantCount={124}
        analytics={analytics as never}
        analyticsState="ready"
        tab={tab}
        onRetry={() => {}}
      />,
    )
  })
  await act(async () => {})
}

test('参加者の板（uNsEy）に表と絞りが出る', async () => {
  await renderTab('participants')
  expect(host.querySelector('[data-design-node="uNsEy"]')).not.toBeNull()
  expect(host.textContent).toContain('参加者')
  expect(host.querySelector('input[placeholder="友だちの名前で探す"]')).not.toBeNull()
})

test('分析の板（z2dgw）にファネルが出る', async () => {
  await renderTab('analytics')
  expect(host.querySelector('[data-design-node="z2dgw"]')).not.toBeNull()
  expect(host.textContent).toContain('どこで人数が減っているか')
})

test('コメント演出の板（Omqd4）に表と保存が出る', async () => {
  await renderTab('comments')
  expect(host.querySelector('[data-design-node="Omqd4"]')).not.toBeNull()
  expect(host.textContent).toContain('流すコメント')
  expect(host.textContent).toContain('保存する')
})
