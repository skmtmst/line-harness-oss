// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsSupportPage from './page'
import { compareLabel, durationLabel, elapsedLabel } from './format'
import type { OpsKnowledgeReference, OpsSupportDetail } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
let draft: { body: string; aiGenerated: boolean; generatedAt: string | null; updatedAt: string; references?: OpsKnowledgeReference[] } | null
let availableReferences: OpsKnowledgeReference[] = []
let aiFails = false
let knowledge: OpsSupportDetail['knowledge']

function respond(url: string, init?: RequestInit) {
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
  calls.push({ url, method, body })
  const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
  if (url.endsWith('/api/ops/support/summary')) {
    return json({ success: true, data: { byStage: { all: 86, new: 3, in_progress: 2, waiting: 1, resolved: 12, closed: 68 }, kpis: { untouched: 3, untouchedFromLine: 3, avgFirstReplyMinutes: 84, prevAvgFirstReplyMinutes: 117, resolutionRate: 96.7, prevResolutionRate: 90.7, avgResolutionMinutes: 312, prevAvgResolutionMinutes: 310 } } })
  }
  if (url.includes('/api/ops/support/tickets?')) return json({ success: true, data: [ticket], total: 86 })
  if (url.endsWith('/api/ops/knowledge/tickets/t1/process')) {
    knowledge = { ...knowledge!, job: { status: 'done', source_current: 1 } }
    return json({ success: true, data: knowledge })
  }
  if (url.endsWith('/draft/ai')) {
    if (aiFails) return json({ success: false, error: 'AI の応答が 45 秒以内に返りませんでした' }, 504)
    const excluded = (body?.excludeArticleIds ?? []) as string[]
    draft = { body: '山田さま\nご連絡ありがとうございます。', aiGenerated: true, generatedAt: '2026-09-15T09:31:00.000+09:00', updatedAt: '2026-09-15T09:31:00.000+09:00', references: availableReferences.filter(ref => !excluded.includes(ref.id)) }
    return json({ success: true, data: draft }, 201)
  }
  if (url.endsWith('/reply')) return json({ success: true, data: { ticket: { ...ticket, stage: 'waiting', stageLabel: '待ち' }, message: {}, mailSent: true, mailSkippedReason: null } }, 201)
  if (url.endsWith('/api/ops/support/tickets/t1')) {
    return json({ success: true, data: { ticket, tenant: { accountCount: 4, staffCount: 6, staffWithLine: 5, pastTickets: 12, pastOpen: 0 }, messages: [
      { id: 'm1', authorKind: 'ops', authorName: '坂本 真人', body: '該当のフォームを確認します。', attachments: [], aiAssisted: false, deliveredVia: ['screen', 'email'], createdAt: '2026-09-15T09:05:00.000+09:00' },
    ], draft, knowledge, ai: { available: true } } })
  }
  return json({ success: false, error: `unexpected ${method} ${url}` }, 404)
}

beforeEach(() => {
  calls = []
  draft = null
  aiFails = false
  knowledge = undefined
  availableReferences = []
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
  vi.useRealTimers()
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
  it('生成予約があると対象だけを自動実行し、完了後は再実行しない', async () => {
    vi.useFakeTimers()
    knowledge = { canProcess: true, article: null, job: { status: 'queued', source_current: 1 } }
    await act(async () => root.render(<OpsSupportPage />)); await flush()
    expect(calls.filter(c => c.url.endsWith('/process'))).toHaveLength(1)
    expect(calls.find(c => c.url.endsWith('/process'))?.method).toBe('POST')
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) }); await flush()
    expect(calls.filter(c => c.url.endsWith('/process'))).toHaveLength(1)
    expect(calls.some(c => c.url.endsWith('/reply'))).toBe(false)
  })

  it.each([false, undefined])('書込許可が %s の画面では生成せず、状態の読取だけを行う', async canProcess => {
    vi.useFakeTimers()
    knowledge = { canProcess, article: null, job: { status: 'queued', source_current: 1 } }
    await act(async () => root.render(<OpsSupportPage />)); await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) }); await flush()
    expect(calls.some(c => c.url.endsWith('/process'))).toBe(false)
    expect(calls.filter(c => c.url.endsWith('/api/ops/support/tickets/t1'))).toHaveLength(2)
  })

  it('長い生成中も返信を書けて、完了時に入力内容を上書きしない', async () => {
    knowledge = { canProcess: true, article: null, job: { status: 'running', source_current: 1 } }
    let finish!: () => void
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/process')) await new Promise<void>(resolve => { finish = resolve })
      return respond(String(input), init)
    }))
    await act(async () => root.render(<OpsSupportPage />)); await flush()
    const textarea = host.querySelector('textarea[aria-label="返信"]') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '対応内容を確認しています。')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => finish()); await flush()
    expect((host.querySelector('textarea[aria-label="返信"]') as HTMLTextAreaElement).value).toBe('対応内容を確認しています。')
  })

  it('実行APIが拒否しても固まらず、エラーを示して自動呼出しを止める', async () => {
    vi.useFakeTimers()
    knowledge = { canProcess: true, article: null, job: { status: 'queued', source_current: 1 } }
    const process = vi.fn(() => new Response(JSON.stringify({ success: false, error: '閲覧のみです' }), { status: 403 }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/process') ? process() : respond(String(input), init)))
    await act(async () => root.render(<OpsSupportPage />)); await flush()
    expect(host.textContent).toContain('この操作をする権限がありません')
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(process).toHaveBeenCalledTimes(1)
  })

  it('再オープン済みの古い生成予約は実行しない', async () => {
    knowledge = { canProcess: true, article: null, job: { status: 'queued', source_current: 0 } }
    await act(async () => root.render(<OpsSupportPage />)); await flush()
    expect(calls.some(c => c.url.endsWith('/process'))).toBe(false)
  })

  it('excludes evidence only for this reply, accumulates exclusions, and does not send automatically', async () => {
    availableReferences = [
      { id: 'ref-a', title: 'フォームの根拠', version: 1, articleKind: 'verified' },
      { id: 'ref-b', title: '配信の根拠', version: 2, articleKind: 'answer_example' },
    ]
    await act(async () => root.render(<OpsSupportPage />)); await flush()
    const click = async (label: string) => {
      await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!.click()); await flush()
    }
    await click('AIで下書きを作る')
    await click('除外して回答を作り直す')
    expect(calls.filter(c => c.url.endsWith('/draft/ai')).at(-1)?.body).toEqual({ excludeArticleIds: ['ref-a'] })
    expect(host.querySelector('[data-design-node="LT8m5"]')?.textContent).not.toContain('フォームの根拠')
    await click('除外して回答を作り直す')
    expect(calls.filter(c => c.url.endsWith('/draft/ai')).at(-1)?.body).toEqual({ excludeArticleIds: ['ref-a', 'ref-b'] })
    expect(host.querySelector('[data-design-node="LT8m5"]')).toBeNull()
    expect(calls.some(c => c.url.endsWith('/reply'))).toBe(false)
    aiFails = true
    await click('作り直す')
    expect((host.querySelector('textarea[aria-label="返信"]') as HTMLTextAreaElement).value).toContain('山田さま')
    expect(host.textContent).toContain('時間内に終わりませんでした')
  })
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
    expect(host.textContent).toContain('お客様の状況・やり取りとナレッジをもとに作った下書きです')
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
