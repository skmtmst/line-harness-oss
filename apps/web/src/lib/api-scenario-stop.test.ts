import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

let api: typeof import('./api').api
beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8788'
  ;({ api } = await import('./api'))
})
afterEach(() => vi.unstubAllGlobals())

describe('シナリオ停止の呼び出し', () => {
  test.each([undefined, { reason: '画像差し替え' }])('任意の理由と停止状態を送り、停止記録を返す', async (input) => {
    const data = { id: 'sc-1', isActive: false, stoppedReason: input?.reason ?? null, stoppedBy: 'staff-1', stoppedAt: '2026-10-07T11:00:00+09:00' }
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const response = await api.scenarios.stop('sc-1', input)
    expect(response).toEqual({ success: true, data })
    expect(fetchSpy.mock.calls[0]).toEqual([
      'http://127.0.0.1:8788/api/scenarios/sc-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ ...input, isActive: false }) }),
    ])
  })

  test('既存の更新関数でも理由を渡せる', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'sc-1' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchSpy)
    await api.scenarios.update('sc-1', { isActive: false, reason: '点検' })
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ isActive: false, reason: '点検' }) })
  })
})
