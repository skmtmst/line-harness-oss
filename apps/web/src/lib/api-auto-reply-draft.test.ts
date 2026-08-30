import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AutoReplyDraftInput } from '@line-crm/shared'

let api: typeof import('./api').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ api } = await import('./api'))
})

const draft: AutoReplyDraftInput = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: 'ご予約を承ります',
  templateId: null,
  lineAccountId: 'account-a',
  activeFrom: null,
  activeUntil: null,
  cooldownMinutes: null,
  skipWhenOperatorActive: false,
  priority: 10,
  messageKinds: null,
  friendConditions: null,
  actions: null,
  responseWeekdays: null,
  responseHolidayRule: null,
  oncePerFriend: false,
  keywords: null,
  respondToAll: false,
  name: '予約問い合わせ',
  keywordMatchMode: 'any',
  folderId: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('自動応答の公開フローAPI', () => {
  it('下書き作成では公開APIを呼ばない', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })))
    vi.stubGlobal('fetch', fetchSpy)

    await api.autoReplies.createDraft(draft)

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/auto-replies/drafts'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(draft) }))
  })

  it('試験は相手と文面を公開とは別の口へ渡す', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })))
    vi.stubGlobal('fetch', fetchSpy)

    await api.autoReplies.testDraft('rule-a', {
      friendId: 'friend-a',
      incomingText: '予約したいです',
      occurredAt: '2026-08-30T03:00:00.000Z',
    })

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/auto-replies/rule-a/test'),
      expect.objectContaining({ method: 'POST' }))
  })

  it('公開時に競合確認と冪等キーを必ず送る', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })))
    vi.stubGlobal('fetch', fetchSpy)

    await api.autoReplies.publishDraft(
      'rule-a',
      { acknowledgedConflictIds: ['rule-b'] },
      'publish-rule-a-v2',
    )

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/auto-replies/rule-a/publish'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'publish-rule-a-v2' }),
        body: JSON.stringify({ acknowledgedConflictIds: ['rule-b'] }),
      }))
  })
})
