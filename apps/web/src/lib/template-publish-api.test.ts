import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * テンプレート公開口の契約(#645・独立審査指摘6)。
 * 詳細口の版をそのまま送り、確認キーを必ず付ける。
 */

let api: typeof import('./api').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ api } = await import('./api'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api.templates.publish', () => {
  it('版の確認と確認キーを付けて公開する', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({
        success: true,
        data: {
          id: 'tpl-1', accountId: 'account-1',
          messageType: 'text', messageContent: '公開版の本文',
          publishedVersion: 1, publishedAt: '2026-09-08T00:00:00+09:00',
          published: true, replayed: false, hasDraft: false, draftRevision: 0,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('crypto', { randomUUID: () => 'key-1' })

    const res = await api.templates.publish('tpl-1', {
      expectedVersion: 0,
      expectedDraftRevision: 2,
    })

    expect(res.success).toBe(true)
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://worker.example.com/api/templates/tpl-1/publish',
    ])
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 2 }),
      headers: expect.objectContaining({ 'Idempotency-Key': 'key-1' }),
    })
  })
})
