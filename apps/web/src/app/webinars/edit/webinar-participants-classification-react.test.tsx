// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditWebinarPage from './page'

/**
 * IDEA-10: ウェビナー参加者の分類フィルタとライブ／録画の区別（画面側）。
 *
 * 本物の React で EditWebinarPage を mount し、api.ts も実物を通す。
 * 差し替えるのは通信(fetch)だけ。分類・閾値・計測可否はサーバー応答が
 * 持ち、画面はそれを表示する。視聴データの無い人を「未視聴」と断定せず
 * 「未参加」、計測不能な人を「計測外」と出すことを確認する。
 */

const fixture = vi.hoisted(() => ({
  params: new URLSearchParams('id=webinar-1'),
}))

const net = vi.hoisted(() => ({
  calls: [] as string[],
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => fixture.params,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [{ id: 'account-a', liffId: 'liff' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/webinars/webinar-form', () => ({ default: () => <div>基本設定</div> }))
vi.mock('@/components/webinars/webinar-notifications', () => ({ default: () => <div>通知設定</div> }))
vi.mock('@/components/shared/select-field', () => ({
  default: ({ options, ...props }: React.ComponentProps<'select'> & { options: Array<{ value: string; label: string }> }) => (
    <select {...props}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
  ),
}))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: React.ReactNode }) => <div>{actions}</div>,
}))

const webinar = {
  id: 'webinar-1', accountId: 'account-a', title: '採用ウェビナー', slug: 'recruit', status: 'active' as const,
  videoPrefix: 'videos/recruit', durationSeconds: 600, schedule: [],
  cta: null, tagOnAttend: null, tagOnCtaClick: null,
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
}

const editor = {
  version: 3, deliveryKind: 'on_demand' as const, viewingCondition: { kind: 'all', label: '全員' },
  publicDescription: '説明', registrationFormId: null, notificationMessages: {}, notificationTest: null,
  actionPolicy: { templateBody: '', missingResultPolicy: 'escalate' as const },
  publicPage: { liffId: 'liff', url: 'https://liff.example.test/preview', unavailableReason: null, description: '', test: null, form: null },
  publication: { status: 'active' as const, draftVersion: 3, publishedVersion: 3, publishedAt: '2026-09-01T00:00:00Z' },
  monitoring: { notificationFailures: 0, duplicateRegistrations: 0, viewSegmentFailures: 0, actionFailures: 0 },
}

const analytics = {
  summary: { reservations: 3, viewers: 2, registeredAndJoined: 2, watched5m: 0, watched15m: 0, completed: 1, avgWatchedSeconds: 400, ctaClicks: 0, formSubmissions: 0 },
  daily: [], sessions: [], dropoff: [], viewSegments: [], participants: [],
  measurement: { state: 'available' as const, reason: null },
  formFunnel: { ctaImpressions: 0, ctaClicks: 0, formOpens: 0, formStarts: 0, submitAttempts: 0, submitSuccesses: 0, submitErrors: 0, fieldCompletions: [] },
}

function participant(over: Record<string, unknown>) {
  return {
    friendId: 'f-1', friendName: '参加者', pictureUrl: null, sessions: 0,
    firstJoinedAt: null, latestJoinedAt: null, maxWatchedSeconds: 0,
    ctaClickedAt: null, registered: true, formSubmittedAt: null,
    actionStatus: null, errorDetail: null, staffIntegrationStatus: 'pending',
    liveSessions: 0, replaySessions: 0, lastJoinKind: null,
    ...over,
  }
}

const participantPage = {
  items: [
    participant({ friendId: 'f-reg', friendName: '申込だけの人', classification: 'unviewed' }),
    participant({
      friendId: 'f-drop', friendName: '途中でやめた人', classification: 'dropped_off',
      sessions: 1, latestJoinedAt: '2026-09-10T20:00:00Z', maxWatchedSeconds: 240,
      liveSessions: 1, lastJoinKind: 'live',
    }),
    participant({
      friendId: 'f-done', friendName: '見終わった人', classification: 'completed',
      sessions: 2, latestJoinedAt: '2026-09-11T21:00:00Z', maxWatchedSeconds: 570,
      liveSessions: 1, replaySessions: 1, lastJoinKind: 'replay',
    }),
  ],
  nextCursor: null,
  measurement: { state: 'available' as const, reason: null },
  rule: { completionThresholdSeconds: 540, durationSeconds: 600 },
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(path)
    if (path.includes('/api/webinars/webinar-1/participants')) {
      return new Response(JSON.stringify({ success: true, data: participantPage }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (path.endsWith('/api/webinars/webinar-1/analytics')) {
      return new Response(JSON.stringify({ success: true, data: analytics }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (path.endsWith('/api/webinars/webinar-1/user-comments')) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (path.endsWith('/api/webinars/webinar-1/editor')) {
      return new Response(JSON.stringify({ success: true, data: editor }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (path.endsWith('/api/webinars/webinar-1')) {
      return new Response(JSON.stringify({ success: true, data: webinar }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.params = new URLSearchParams('id=webinar-1&pane=participants')
  net.calls.length = 0
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

describe('ウェビナー参加者の分類表示と絞り込み (IDEA-10)', () => {
  it('分類ラベル・ライブ/録画・分類の根拠を出し、未視聴とは断定しない', async () => {
    await act(async () => { root.render(<EditWebinarPage />) })
    await flush()

    // 分類の根拠（完了閾値 540秒=9:00 はサーバー応答の rule から）。
    expect(host.textContent).toContain('分類の根拠')
    expect(host.textContent).toContain('9:00')
    // 未参加・途中離脱・完了・録画/ライブの区別。
    expect(host.textContent).toContain('未参加')
    expect(host.textContent).toContain('途中離脱 40%')
    expect(host.textContent).toContain('視聴完了 95%')
    expect(host.textContent).toContain('ライブ1')
    expect(host.textContent).toContain('録画1')
    // 「未視聴」という断定表示はしない。
    expect(host.textContent).not.toContain('未視聴')
  })

  it('分類セレクトで絞り込み、APIとCSV導線にfilterを載せる', async () => {
    await act(async () => { root.render(<EditWebinarPage />) })
    await flush()

    const select = host.querySelector('select[aria-label="参加者の分類で絞り込む"]') as HTMLSelectElement | null
    expect(select).not.toBeNull()
    const labels = Array.from(select!.querySelectorAll('option')).map((option) => option.textContent)
    expect(labels).toEqual([
      'すべての申込・参加者',
      '未参加（申込のみ・入場記録なし）',
      '途中離脱（入場したが未完了）',
      '視聴完了',
      '計測外',
    ])

    await act(async () => {
      select!.value = 'unviewed'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    expect(net.calls.some((call) => call.includes('participants?') && call.includes('filter=unviewed'))).toBe(true)
    // #1053: CSVは直リンクではなくボタン＋認証付き取得。押すとfilter付きで取る。
    const csvButton = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('CSVで書き出す')) as HTMLButtonElement | undefined
    expect(csvButton).not.toBeUndefined()
    const callsBefore = net.calls.length
    await act(async () => { csvButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(net.calls.slice(callsBefore).some((call) =>
      call.includes('/api/webinars/webinar-1/participants.csv') && call.includes('filter=unviewed'))).toBe(true)
  })
})
