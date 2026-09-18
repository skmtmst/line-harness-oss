// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsSupportPage from './page'
import { compareLabel, durationLabel, elapsedLabel } from './format'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

/** ★V6 37-6 お問い合わせ。一覧・内容・返信・AI下書きの3状態が API の形どおりに出ること。 */

const ticket = {
  id: 't1', ticketNo: 312, ticketLabel: '#MB-0312', tenantId: 'tenant-a', tenantName: '株式会社サンプル',
  tenantPlanKey: 'standard', tenantPlanStatus: 'active', tenantStatus: 'active',
  staffId: 's1', staffName: '山田 太郎', staffRole: 'owner', staffEmailRegistered: true,
  kind: 'bug', kindLabel: '不具合', subject: '回答フォームからタグが付かない', subjectAuto: false,
  body: '設定したタグが友だちに付きません。', attachments: [{ key: 'support/a.png', url: 'https://api.example.test/images/support/a.png', name: 'a.png' }],
  stage: 'new', stageLabel: '新規', priority: 'high', priorityLabel: '高', channel: 'admin', channelLabel: '管理画面',
  assigneeStaffId: null, replyCount: 0, firstRepliedAt: null, lastMessageAt: new Date().toISOString(), resolvedAt: null, closedAt: null,
  createdAt: '2026-09-15T08:40:00.000+09:00', updatedAt: '2026-09-15T08:40:00.000+09:00',
}

let host: HTMLDivElement
let root: Root
let calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }>
let draft: { body: string; aiGenerated: boolean; generatedAt: string | null; updatedAt: string } | null
let aiFails = false

function respond(url: string, init?: RequestInit) {
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
  calls.push({ url, method, body })
  const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
  if (url.endsWith('/api/ops/support/summary')) {
    return json({ success: true, data: { byStage: { all: 86, new: 3, in_progress: 2, waiting: 1, resolved: 12, closed: 68 }, kpis: { untouched: 3, untouchedFromLine: 3, avgFirstReplyMinutes: 84, prevAvgFirstReplyMinutes: 117, resolutionRate: 96.7, prevResolutionRate: 90.7, avgResolutionMinutes: 312, prevAvgResolutionMinutes: 310 } } })
  }
  if (url.includes('/api/ops/support/tickets?')) return json({ success: true, data: [ticket], total: 86 })
  if (url.endsWith('/draft/ai')) {
    if (aiFails) return json({ success: false, error: 'AI の応答が 45 秒以内に返りませんでした' }, 504)
    draft = { body: '山田さま\nご連絡ありがとうございます。', aiGenerated: true, generatedAt: '2026-09-15T09:31:00.000+09:00', updatedAt: '2026-09-15T09:31:00.000+09:00' }
    return json({ success: true, data: draft }, 201)
  }
  if (url.endsWith('/reply')) return json({ success: true, data: { ticket: { ...ticket, stage: 'waiting', stageLabel: '待ち' }, message: {}, mailSent: true, mailSkippedReason: null } }, 201)
  if (url.endsWith('/api/ops/support/tickets/t1')) {
    return json({ success: true, data: { ticket, tenant: { accountCount: 4, staffCount: 6, staffWithLine: 5, pastTickets: 12, pastOpen: 0 }, messages: [
      { id: 'm1', authorKind: 'ops', authorName: '坂本 真人', body: '該当のフォームを確認します。', attachments: [], aiAssisted: false, deliveredVia: ['screen', 'email'], createdAt: '2026-09-15T09:05:00.000+09:00' },
    ], draft, ai: { available: true } } })
  }
  return json({ success: false, error: `unexpected ${method} ${url}` }, 404)
}

beforeEach(() => {
  calls = []
  draft = null
  aiFails = false
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init)))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('表記の決まり', () => {
  it('経過時間は 分前・時間前・日前', () => {
    const now = Date.parse('2026-09-15T10:00:00.000+09:00')
    expect(elapsedLabel('2026-09-15T09:35:00.000+09:00', now)).toBe('25分前')
    expect(elapsedLabel('2026-09-15T08:00:00.000+09:00', now)).toBe('2時間前')
    expect(elapsedLabel('2026-09-11T10:00:00.000+09:00', now)).toBe('4日前')
  })
  it('所要時間は 1時間24分 のように出す', () => {
    expect(durationLabel(84)).toBe('1時間24分')
    expect(durationLabel(312)).toBe('5時間12分')
    expect(durationLabel(30)).toBe('30分')
    expect(durationLabel(null)).toBe('—')
  })
  it('先月との比べ方（時間は短いほど良い、割合は高いほど良い）', () => {
    expect(compareLabel(84, 117, 'time')).toBe('先月より 28% 早い')
    expect(compareLabel(96.7, 90.7, 'rate')).toBe('先月より 6% 改善')
    expect(compareLabel(312, 310, 'time')).toBe('先月とほぼ同じ')
    expect(compareLabel(84, null, 'time')).toBe('先月の記録なし')
    expect(compareLabel(null, 10, 'rate')).toBe('今月の記録なし')
  })
})

describe('画面', () => {
  it('AI が失敗（5xx）しても「作成中…」のまま固まらず、エラー文を出して手書きに戻る', async () => {
    aiFails = true
    await act(async () => { root.render(<OpsSupportPage />) })
    await flush()
    const aiButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('AIで下書きを作る'))
    await act(async () => { aiButton!.click() })
    await flush()
    expect(host.textContent).not.toContain('AIが下書きを作っています')
    expect(host.textContent).toContain('時間内に終わりませんでした')
    expect(host.querySelector('textarea[aria-label="返信"]')).not.toBeNull()
  })

  it('状態タブの件数・数値カード・一覧・内容と返信が出る', async () => {
    await act(async () => { root.render(<OpsSupportPage />) })
    await flush()
    const text = host.textContent ?? ''
    expect(text).toContain('すべて')
    expect(text).toContain('86')
    expect(text).toContain('未対応のチケット')
    expect(text).toContain('LINEから受付 3件')
    expect(text).toContain('1時間24分')
    expect(text).toContain('先月より 28% 早い')
    expect(text).toContain('96.7%')
    expect(text).toContain('#MB-0312')
    expect(text).toContain('回答フォームからタグが付かない')
    expect(text).toContain('管理画面のお問い合わせ')
    expect(text).toContain('6人中5人')
    expect(text).toContain('12件（未解決 0）')
    expect(text).toContain('musubo 運営 ／ 坂本 真人')
    expect(text).toContain('a.png（契約先から）')
    expect(text).toContain('AIで下書きを作る')
    expect(host.querySelector('[data-design-node="IjIFa"]')).not.toBeNull()
  })

  it('AIで下書きを作ると案内と作成時刻が出て、送ると aiAssisted 付きで返信 API を呼ぶ', async () => {
    await act(async () => { root.render(<OpsSupportPage />) })
    await flush()
    const aiButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('AIで下書きを作る'))
    expect(aiButton).toBeDefined()
    await act(async () => { aiButton!.click() })
    await flush()
    expect(host.textContent).toContain('AIが作った下書きです')
    expect(host.textContent).toContain('作り直す')
    expect(host.querySelector('[data-design-node="b2uv3"]')).not.toBeNull()
    const textarea = host.querySelector('textarea[aria-label="返信"]') as HTMLTextAreaElement
    expect(textarea.value).toContain('山田さま')
    const send = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '返信する')
    await act(async () => { send!.click() })
    await flush()
    const reply = calls.find((c) => c.url.endsWith('/reply'))
    expect(reply?.body).toMatchObject({ aiAssisted: true })
    expect(String(reply?.body?.body)).toContain('山田さま')
    expect(host.textContent).toContain('登録メールにも送りました')
  })
})
