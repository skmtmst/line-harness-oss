// @vitest-environment happy-dom
/*
 * V8 ウェビナーの編集（src/v8/webinar-edit）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * - 入口（app/webinars/edit/page.tsx）は V8 のときだけこの画面を出す
 * - 参加者・分析・コメント演出は詳細の頭とタブ、作る手順の段は5段の帯
 * - 閲覧のみ（staff）には、押せないボタンを置かない（変える操作は隠す）
 * - コメント演出はその場で直して、秒の順に並べて保存する
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const nav = vi.hoisted(() => ({ search: 'id=webinar-1&pane=participants' }))
const roleState = vi.hoisted(() => ({ role: 'owner' as string | null }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/webinars/edit',
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [{ id: 'account-a', name: '本店', liffId: 'liff-1' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => roleState.role }
})

import EditPage from '@/app/webinars/edit/page'
import WebinarEditV8 from './edit'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const webinar = {
  id: 'webinar-1', accountId: 'account-a', title: 'NEN活用スタートセミナー', slug: 'nen-start', status: 'active',
  videoPrefix: 'webinars/nen-start.mp4', durationSeconds: 872, schedule: [{ type: 'daily', time: '10:00' }], cta: null,
  tagOnAttend: null, tagOnCtaClick: null, publicationState: 'always', publicationStartsAt: null, publicationEndsAt: null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
}
const editor = {
  version: 3, deliveryKind: 'on_demand', ctaCount: 1, viewingCondition: { kind: 'registered', label: '申込者向け' },
  publicDescription: '15分で使い方がわかる', registrationFormId: null,
  notificationMessages: { dayBefore: '明日からです' }, notificationTest: null,
  actionPolicy: { templateBody: 'ありがとうございました', missingResultPolicy: 'escalate' },
  publicPage: { liffId: 'liff-1', url: 'https://liff.line.me/liff-1/webinar/nen-start', unavailableReason: null, description: '', test: null, form: null },
  publication: { status: 'active', draftVersion: 3, publishedVersion: 3, publishedAt: null },
  monitoring: { notificationFailures: 0, duplicateRegistrations: 0, viewSegmentFailures: 0, actionFailures: 0 },
}
const analytics = {
  summary: { reservations: 124, viewers: 100, registeredAndJoined: 100, watched5m: 90, watched15m: 80, completed: 71, avgWatchedSeconds: 372, ctaClicks: 23, formSubmissions: 9 },
  daily: [], participants: [], sessions: [], dropoff: [], viewSegments: [],
  retention: { bucketSeconds: 60, started: 100, points: [{ atSeconds: 0, viewers: 100 }, { atSeconds: 600, viewers: 70 }] },
  heartbeatRejects: 0, ctaAtSeconds: 300, measurement: { state: 'available', reason: null }, formFunnel: null,
}
const participants = {
  items: [
    { friendId: 'f-1', friendName: 'Kenta Kawano', pictureUrl: null, sessions: 2, registered: true, firstJoinedAt: '2026-09-30T01:12:00Z', latestJoinedAt: '2026-09-30T01:12:00Z', maxWatchedSeconds: 872, ctaClickedAt: '2026-09-30T01:20:00Z', formSubmittedAt: null, classification: 'completed' },
    { friendId: 'f-2', friendName: '山田 太郎', pictureUrl: null, sessions: 0, registered: true, firstJoinedAt: null, latestJoinedAt: null, maxWatchedSeconds: 0, ctaClickedAt: null, formSubmittedAt: null, classification: 'unviewed' },
  ],
  nextCursor: null,
}
let comments = [
  { atSeconds: 45, authorName: 'まさ', body: 'わかりやすい！' },
  { atSeconds: -60, authorName: '田中', body: 'こんばんは' },
]
const puts: Array<{ path: string; body: unknown }> = []
const conflictState = vi.hoisted(() => ({ ctas: false }))

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  roleState.role = 'owner'
  puts.length = 0
  conflictState.ctas = false
  comments = [
    { atSeconds: 45, authorName: 'まさ', body: 'わかりやすい！' },
    { atSeconds: -60, authorName: '田中', body: 'こんばんは' },
  ]
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (method === 'PUT') {
      puts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (conflictState.ctas && path.endsWith('/ctas')) return json({ success: false, error: 'ほかの人が保存しました', code: 'version_conflict' }, 409)
      if (path.endsWith('/comments')) return json({ data: { count: (JSON.parse(String(init?.body)) as { comments: unknown[] }).comments.length } })
      return json({ data: { count: 0 } })
    }
    if (path === '/api/webinars/webinar-1') return json({ data: webinar })
    if (path.endsWith('/editor')) return json({ data: editor })
    if (path.endsWith('/analytics')) return json({ data: analytics })
    if (path.endsWith('/participants')) return json({ data: participants })
    if (path.endsWith('/user-comments')) return json({ data: [] })
    if (path.endsWith('/comments')) return json({ data: comments })
    if (path.endsWith('/notifications')) return json({ data: { settings: { webinarId: 'webinar-1', version: 1, registrationEnabled: true, dayBeforeEnabled: true, dayBeforeTime: '19:00', hourBeforeEnabled: false, hourBeforeMinutes: 15, startEnabled: true, missedEnabled: false, missedTime: '10:00', missedWindowDays: 3, completedEnabled: true, updatedAt: '' }, overview: { total: 10, pending: 0, sent: 9, failed: 1, skipped: 0, cancelled: 0, skippedReasons: [], audience: { people: 10, bookings: 10, definition: 'active_registrations' } } } })
    if (path.endsWith('/actions')) return json({ data: [] })
    if (path.endsWith('/ctas')) return json({ data: [{ atSeconds: 300, kind: 'url', title: '資料', body: null, buttonLabel: '受け取る', autoOpen: false, formId: null, url: 'https://example.com' }] })
    if (path.endsWith('/video-asset')) return json({ data: { asset: null } })
    if (path.endsWith('/publish-validation')) return json({ data: { version: 3, checks: [{ key: 'video_ready', label: '動画の準備ができている', status: 'passed', detail: null }], blockers: [], warnings: [] } })
    if (path === '/api/forms') return json({ success: true, data: [] })
    if (path.includes('/folders')) return json({ success: true, data: [] })
    return json({ data: null })
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

async function render(node: React.ReactNode) {
  await act(async () => { root.render(node) })
  for (let i = 0; i < 6; i += 1) await act(async () => {})
}

const buttons = () => [...document.querySelectorAll('button')] as HTMLButtonElement[]
const buttonText = (text: string) => buttons().find((button) => button.textContent?.trim() === text)

describe('V8 ウェビナーの編集', () => {
  it('入口は V8 のときだけ新しい画面を出す（v7 の見た目では今の画面のまま）', async () => {
    nav.search = 'id=webinar-1&pane=participants'
    await render(<EditPage />)
    expect(host.querySelector('[data-wc-editor="v8"]')).toBeTruthy()
    document.documentElement.dataset.theme = 'v7'
    act(() => { root.unmount() })
    root = createRoot(host)
    await render(<EditPage />)
    expect(host.querySelector('[data-wc-editor="v8"]')).toBeNull()
  })

  it('参加者（uNsEy）：頭・タブ（参加者の人数つき）・数の帯・表・チャットへの道', async () => {
    nav.search = 'id=webinar-1&pane=participants'
    await render(<WebinarEditV8 />)
    expect(host.textContent).toContain('NEN活用スタートセミナー')
    expect(host.textContent).toContain('オンデマンド・いつでも視聴・公開中（版 3）')
    const tabs = host.querySelector('[data-wc-tabs="true"]')
    expect(tabs?.textContent).toContain('参加者 124')
    expect(tabs?.querySelector('[aria-current="page"]')?.textContent).toBe('参加者 124')
    expect(host.textContent).toContain('視聴完了 71')
    expect(host.textContent).toContain('見ていない・見逃し案内の対象')
    const chat = host.querySelector('a[href="/chats?friend=f-1"]')
    expect(chat?.textContent).toContain('チャットを見る')
    expect(buttonText('CSV で書き出す')).toBeTruthy()
  })

  it('作る手順の段（④通知）：5段の帯から別の段へ移れる', async () => {
    nav.search = 'id=webinar-1&pane=notifications'
    await render(<WebinarEditV8 />)
    expect(host.textContent).toContain('通知と視聴後のこと')
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('通知')
    const video = buttons().find((button) => button.textContent?.includes('動画') && button.closest('[data-part="steps"]'))
    expect(video).toBeTruthy()
    await act(async () => { video!.click() })
    for (let i = 0; i < 4; i += 1) await act(async () => {})
    expect(host.textContent).toContain('動画と公開期間')
  })

  it('閲覧のみ（staff）には、押せないボタンを置かない（通知・CTA・コメント演出）', async () => {
    roleState.role = 'staff'
    for (const pane of ['notifications', 'cta', 'comments', 'basic', 'video', 'review']) {
      nav.search = `id=webinar-1&pane=${pane}`
      act(() => { root.unmount() })
      root = createRoot(host)
      await render(<WebinarEditV8 />)
      const disabled = buttons().filter((button) => button.disabled && host.contains(button))
      expect(disabled.map((button) => `${pane}:${button.textContent?.trim() || button.getAttribute('aria-label')}`)).toEqual([])
      expect(buttonText('下書きを保存')).toBeUndefined()
      expect(buttons().some((button) => /テストを送る|条件を足す|保存する|コメントを足す|CTA カードを足す|この版を公開/.test(button.textContent ?? ''))).toBe(false)
    }
  })

  it('コメント演出（Omqd4）：その場で直して、秒の順に並べて保存する', async () => {
    nav.search = 'id=webinar-1&pane=comments'
    await render(<WebinarEditV8 />)
    const body = host.querySelector('input[aria-label="1行目の本文"]') as HTMLInputElement
    expect(body.value).toBe('わかりやすい！')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(body, 'とてもわかりやすい')
      body.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = buttons().find((button) => button.textContent?.includes('保存する'))
    expect(save).toBeTruthy()
    await act(async () => { save!.click() })
    for (let i = 0; i < 4; i += 1) await act(async () => {})
    const put = puts.find((entry) => entry.path.endsWith('/comments'))
    expect(put?.body).toEqual({ comments: [
      { atSeconds: -60, authorName: '田中', body: 'こんばんは' },
      { atSeconds: 45, authorName: 'まさ', body: 'とてもわかりやすい' },
    ] })
    expect(host.textContent).toContain('2件保存しました')
  })
  it('CTA（pvimJ）：保存が競合したら帯を左右の列の上に出し、下書きの保存を「比べてから保存」に替える', async () => {
    conflictState.ctas = true
    nav.search = 'id=webinar-1&pane=cta'
    await render(<WebinarEditV8 />)
    expect(host.querySelector('[data-design-node="pvimJ"]')).toBeNull()
    await act(async () => { buttonText('下書きを保存')!.click() })
    for (let i = 0; i < 6; i += 1) await act(async () => {})
    const band = host.querySelector('[data-design-node="pvimJ"][role="alert"]')
    expect(band?.textContent).toContain('このまま保存すると、ほかの人の変更が消えます')
    expect(buttonText('下書きを保存')).toBeUndefined()
    expect(buttonText('比べてから保存')).toBeTruthy()
    expect([...host.querySelectorAll('a')].some((link) => link.textContent?.trim() === 'キャンセル')).toBe(true)
  })
})
