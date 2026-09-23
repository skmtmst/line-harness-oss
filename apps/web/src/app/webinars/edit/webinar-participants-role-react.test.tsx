// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditWebinarPage from './page'

/**
 * ウェビナー個人視聴履歴の owner/admin 境界に合わせた画面側の制御(N-118)。
 *
 * 本物のReactで本物の `EditWebinarPage` を mount し、`api.ts` も実物を通す。
 * 差し替えるのは通信(fetch)・アカウント文脈・ルーティングだけ。
 * staff は `GET /api/webinars/:id/participants` が 403 で落ちる——
 * そのとき画面は個人履歴・CSV導線を出さず、集計は表示を続ける。
 */

const fixture = vi.hoisted(() => ({
  params: new URLSearchParams('id=webinar-1'),
  accountId: 'account-a',
}))

const net = vi.hoisted(() => ({
  calls: [] as string[],
  /** staff 相当: participants 口は 403、analytics の個人配列は空。 */
  staffMode: false,
  /** 応答を遅らせたいとき試験が差し込む。 */
  pending: null as null | { path: RegExp; promise: Promise<never> },
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => fixture.params,
  usePathname: () => '/webinars/edit',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [{ id: fixture.accountId, liffId: 'liff' }], loading: false }),
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
  id: 'webinar-1', accountId: 'account-a', title: '採用ウェビナー', slug: 'recruit', status: 'draft' as const,
  videoPrefix: 'videos/recruit', durationSeconds: 600, schedule: [],
  cta: { label: '相談する', url: 'https://example.test', showAtSeconds: 60 },
  tagOnAttend: null, tagOnCtaClick: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
}

const editor = {
  version: 3, deliveryKind: 'on_demand' as const, viewingCondition: { kind: 'all', label: '全員' },
  publicDescription: '説明', registrationFormId: null, notificationMessages: {}, notificationTest: null,
  actionPolicy: { templateBody: '', missingResultPolicy: 'escalate' as const },
  publicPage: { liffId: 'liff', url: 'https://liff.example.test/preview', unavailableReason: null, description: '', test: null, form: null },
  publication: { status: 'draft' as const, draftVersion: 3, publishedVersion: null, publishedAt: null },
  monitoring: { notificationFailures: 0, duplicateRegistrations: 0, viewSegmentFailures: 0, actionFailures: 0 },
}

const FRIEND_NAME = '参加者 甲'

function analytics(withIndividuals: boolean) {
  return {
    summary: { reservations: 1, viewers: 1, registeredAndJoined: 1, watched5m: 0, watched15m: 0, completed: 0, avgWatchedSeconds: 900, ctaClicks: 1, formSubmissions: 0 },
    daily: [], sessions: [], dropoff: [], viewSegments: [],
    participants: withIndividuals ? [{
      friendId: 'friend-a1', friendName: FRIEND_NAME, pictureUrl: null, sessions: 1,
      firstJoinedAt: '2026-09-10T20:00:00Z', latestJoinedAt: '2026-09-10T20:00:00Z',
      maxWatchedSeconds: 900, ctaClickedAt: '2026-09-10T20:30:00Z', registered: true, formSubmittedAt: null,
    }] : [],
    measurement: { state: 'available' as const, reason: null },
    formFunnel: { ctaImpressions: 0, ctaClicks: 0, formOpens: 0, formStarts: 0, submitAttempts: 0, submitSuccesses: 0, submitErrors: 0, fieldCompletions: [] },
  }
}

const participantPage = {
  items: [{
    friendId: 'friend-a1', friendName: FRIEND_NAME, pictureUrl: null, sessions: 1,
    firstJoinedAt: '2026-09-10T20:00:00Z', latestJoinedAt: '2026-09-10T20:00:00Z',
    maxWatchedSeconds: 900, ctaClickedAt: '2026-09-10T20:30:00Z', registered: true,
    formSubmittedAt: null, actionStatus: null, errorDetail: null, staffIntegrationStatus: 'pending',
  }],
  nextCursor: null,
}

/** 通信そのものを差し替える。api・fetchApiは実物を通す。 */
function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(path)
    if (net.pending && net.pending.path.test(path)) {
      await net.pending.promise
    }
    if (path.includes('/api/webinars/webinar-1/participants')) {
      if (net.staffMode) {
        return new Response(JSON.stringify({ success: false, error: 'この操作にはオーナー権限が必要です' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, data: participantPage }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (path.endsWith('/api/webinars/webinar-1/analytics')) {
      return new Response(JSON.stringify({ success: true, data: analytics(!net.staffMode) }), {
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
  fixture.params = new URLSearchParams('id=webinar-1')
  net.calls.length = 0
  net.staffMode = false
  net.pending = null
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

async function render() {
  await act(async () => { root.render(<EditWebinarPage />) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function csvLinks(): string[] {
  return Array.from(host.querySelectorAll('a'))
    .map((anchor) => anchor.getAttribute('href') ?? '')
    .filter((href) => href.includes('participants.csv'))
}

/*
 * #1053: CSVは直リンクではなく認証付き取得になった。
 * ボタンを押すと fetch で participants.csv を取ることを確かめる。
 */
function csvButton(label = 'CSVで書き出す'): HTMLButtonElement | null {
  return Array.from(host.querySelectorAll('button'))
    .find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined ?? null
}

describe('ウェビナー編集の参加者導線と権限 (N-118)', () => {
  it('staff が参加者の段を開くと、個人履歴もCSV導線も出さず制限の案内を出す', async () => {
    net.staffMode = true
    fixture.params = new URLSearchParams('id=webinar-1&pane=participants')
    await render()
    await flush()

    expect(host.textContent).toContain('オーナーと管理者だけが確認できます')
    expect(host.textContent).not.toContain('参加者をCSVで書き出す')
    expect(host.textContent).not.toContain(FRIEND_NAME)
    // staff が辿っても 403 になるCSVへの導線(dead link)はDOMに存在しない。
    expect(csvLinks()).toEqual([])
    // 「まだ参加者がいません」の誤表示もしない。
    expect(host.textContent).not.toContain('まだ参加者がいません')
  })

  it('staff の分析の段は集計を出したまま、CSV導線だけを出さない', async () => {
    net.staffMode = true
    fixture.params = new URLSearchParams('id=webinar-1&pane=analytics')
    await render()
    await flush()

    expect(host.textContent).toContain('視聴結果')
    expect(host.textContent).toContain('15:00') // 平均視聴時間900秒の集計は見える
    expect(csvLinks()).toEqual([])
    expect(host.textContent).not.toContain(FRIEND_NAME)
  })

  it('staff には応答待ちの間もCSV導線を出さない', async () => {
    net.staffMode = true
    let release!: () => void
    net.pending = { path: /participants/, promise: new Promise<never>((resolve) => { release = resolve as () => void }) }
    fixture.params = new URLSearchParams('id=webinar-1&pane=analytics')
    await render()
    await flush()

    // participants の許可判定が届く前。集計は出るがCSV導線は出ない。
    expect(csvLinks()).toEqual([])
    await act(async () => { release(); await Promise.resolve() })
    await flush()
    expect(csvLinks()).toEqual([])
  })

  it('owner は参加者の段で個人履歴とCSV導線を見られる', async () => {
    fixture.params = new URLSearchParams('id=webinar-1&pane=participants')
    await render()
    await flush()

    expect(host.textContent).toContain('参加者管理')
    expect(host.textContent).toContain(FRIEND_NAME)
    expect(host.textContent).toContain('参加者をCSVで書き出す')
    // 直リンクのaタグは無く、押すと認証付きで取る（#1053）。
    expect(csvLinks()).toEqual([])
    const callsBefore = net.calls.length
    await act(async () => { csvButton('参加者をCSVで書き出す')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(net.calls.slice(callsBefore).some((call) => call.includes('/api/webinars/webinar-1/participants.csv'))).toBe(true)
  })

  it('owner は分析の段でもCSV導線を見られる', async () => {
    fixture.params = new URLSearchParams('id=webinar-1&pane=analytics')
    await render()
    await flush()

    expect(host.textContent).toContain('視聴結果')
    expect(csvLinks()).toEqual([])
    const callsBefore = net.calls.length
    await act(async () => { csvButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(net.calls.slice(callsBefore).some((call) => call.includes('/api/webinars/webinar-1/participants.csv'))).toBe(true)
  })
})
