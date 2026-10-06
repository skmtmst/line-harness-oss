// @vitest-environment happy-dom
/*
 * ★V8 外部連携（src/v8/webhooks）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 受け取り口を作る窓（H031gC）・閲覧のみで押せない物を置かない・同期の記録の束ね方・
 * やり取りの記録の札と中身の2行・作る画面の既定（選んだものだけ送る）と詳細条件。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/webhooks',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
let role = 'owner'
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role }
})

import WebhooksIncomingV8 from './incoming'
import WebhooksSamplesV8 from './samples'
import WebhooksInteractionsV8 from './interactions'
import WebhooksCreateV8 from './create'
import { groupRuns } from './sheets'
import { eventLabel, maskedUrl } from './words'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const SUMMARY = { total: 2146, outgoing: 1734, incoming: 412, succeeded: 2144, failed: 2, resultUnknown: 0, outgoingFailed: 2, retryable: 2, averageDurationMs: 400 }
const INLET = { id: 'in-1', name: '申込フォーム', sourceType: 'form', hasSecret: true, isActive: true, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }

let root: Root
let host: HTMLDivElement
let posted: Array<{ url: string; body: unknown }> = []

beforeEach(() => {
  role = 'owner'
  search = ''
  posted = []
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method && init.method !== 'GET') posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
    if (url.includes('/staff/me')) return json({ success: true, data: { role } })
    if (url.includes('/unmatched')) return json({ success: true, data: [], total: 0 })
    if (/\/api\/webhooks\/incoming\/in-1/.test(url)) {
      return json({ success: true, data: { ...INLET, version: 1, identityMatching: { methods: [{ kind: 'verified_email', path: '$.email' }], onNotFound: 'do_nothing' }, actions: [], actionExecution: { state: 'not_configured', reason: null }, latestSample: null, templateFields: [], pendingUnmatched: 0, previousSecretUsableUntil: null } })
    }
    if (url.includes('/api/webhooks/incoming')) return json({ success: true, data: [INLET] })
    if (url.includes('/api/webhooks/outgoing')) return json({ success: true, data: [] })
    if (url.includes('/interactions')) {
      return json({ success: true, data: { total: 1, page: 1, limit: 20, summary: SUMMARY, items: [{
        id: 'wi-1', direction: 'outgoing', webhookName: '予約台帳', eventType: 'booking_created', triggerSummary: '予約が入った・Masato S.',
        status: 'failed', responseLabel: '500 エラー', responseStatus: 500, attemptCount: 3, durationMs: 30000, failureReason: null,
        failureReasonCode: 'response_5xx', canRetry: true, retryBlockReason: null, autoRetryNextAt: null,
        startedAt: '2026-09-30T00:58:00.000Z', completedAt: null, retryOfId: null,
      }] } })
    }
    if (url.includes('/api/folders')) return json({ success: true, data: [] })
    return json({ success: false, error: 'not found' }, 404)
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
  await act(async () => {})
  await act(async () => {})
}

const buttons = () => [...document.querySelectorAll('button, a')] as HTMLElement[]

describe('外部連携 V8', () => {
  it('受け取り口を作る：窓（H031gC）が開き、名前が空なら作らずに理由を出す', async () => {
    await render(<WebhooksIncomingV8 />)
    const open = buttons().find((element) => element.textContent?.includes('受け取り口を作る'))!
    await act(async () => { open.click() })
    const dialog = document.querySelector('[data-design-node="H031gC"]')
    expect(dialog?.textContent).toContain('受け取る設定を追加')
    expect(dialog?.textContent).toContain('作るときに本人確認が出ます。')
    const create = [...dialog!.querySelectorAll('button')].find((element) => element.textContent?.includes('作る') && !element.textContent.includes('受け取り口'))!
    await act(async () => { create.click() })
    expect(dialog?.textContent).toContain('名前を入力してください')
    expect(posted.filter((item) => item.url.includes('/api/webhooks/incoming'))).toHaveLength(0)
  })

  it('閲覧のみ：受け取り口を作る・見本で作る・まとめてやり直すを置かず、閲覧のみの帯を出す', async () => {
    role = 'staff'
    await render(<WebhooksIncomingV8 />)
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(buttons().some((element) => element.textContent?.includes('受け取り口を作る'))).toBe(false)
    act(() => { root.unmount() })
    root = createRoot(host)
    await render(<WebhooksSamplesV8 />)
    expect(buttons().some((element) => element.textContent?.includes('この見本で作る'))).toBe(false)
    act(() => { root.unmount() })
    root = createRoot(host)
    await render(<WebhooksInteractionsV8 />)
    expect(buttons().some((element) => element.textContent?.includes('まとめてやり直す'))).toBe(false)
  })

  it('やり取りの記録：札に件数、中身は「・」の前を1行目・後ろと経緯を2行目に出す', async () => {
    await render(<WebhooksInteractionsV8 />)
    expect(host.textContent).toContain('すべて 2,146')
    expect(host.textContent).toContain('失敗 2')
    const row = host.querySelector('tr[data-row-id="wi-1"]')
    expect(row?.textContent).toContain('予約が入った')
    expect(row?.textContent).toContain('Masato S.・3回やり直して失敗')
    expect(row?.textContent).toContain('30.0 秒')
  })

  it('作る：既定は「選んだものだけ送る」。絵に無い出来事は詳細条件を開くと選べる', async () => {
    await render(<WebhooksCreateV8 />)
    const selected = host.querySelector('input[name="wh-new-mode"][value="selected"]') as HTMLInputElement
    expect(selected.checked).toBe(true)
    expect(host.textContent).toContain('問い合わせが来た')
    expect(host.textContent).not.toContain('フォームが送られた')
    const details = buttons().find((element) => element.textContent?.includes('詳細条件'))!
    await act(async () => { details.click() })
    expect(host.textContent).toContain('フォームが送られた')
  })

  it('作る：見本から絵に無い出来事で来たら、詳細条件を開いてその出来事を選んでおく', async () => {
    search = 'event=form_submitted'
    await render(<WebhooksCreateV8 />)
    expect(host.textContent).toContain('フォームが送られた')
  })

  it('同期の記録：同じ時刻の行を束ね、失敗で0件の行は書き出したものに数えない', () => {
    const run = (id: string, dataType: 'friends' | 'form_answers', status: 'ok' | 'partial' | 'error', rowsWritten: number, startedAt: string) => ({
      id, kind: 'scheduled' as const, dataType, status, rowsWritten, error: null, startedAt, finishedAt: startedAt,
    })
    const groups = groupRuns([
      run('a', 'friends', 'ok', 1280, 't1'),
      run('b', 'form_answers', 'partial', 0, 't1'),
      run('c', 'friends', 'error', 0, 't2'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].parts).toEqual(['友だち 1,280', 'フォーム回答 0'])
    expect(groups[0].status).toBe('partial')
    expect(groups[1].parts).toEqual([])
    expect(groups[1].status).toBe('error')
  })

  it('言葉：URLは道を伏せる・いつ送るかは2つまで並べて残りは件数', () => {
    expect(maskedUrl('https://crm.example.com/line/hook?token=x')).toBe('https://crm.example.com/••••')
    expect(eventLabel(['friend_add', 'tag_change'])).toBe('友だちになった・タグが付いた')
    expect(eventLabel(['friend_add', 'tag_change', 'booking_created'])).toBe('友だちになった・タグが付いた ほか1件')
  })
})
