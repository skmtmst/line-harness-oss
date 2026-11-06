import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let api: typeof import('../index').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ api } = await import('../index'))
})

afterEach(() => vi.unstubAllGlobals())

describe('autoReplies.stop', () => {
  it('専用の停止口へ、理由と確認キーを付けて POST する', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { id: 'ar-1', isActive: false, stoppedAt: null, stoppedByStaffId: null, stoppedByStaffName: null, stopReason: '一時停止' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)

    await api.autoReplies.stop('ar-1', { reason: '一時停止' }, 'key-1')

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://worker.example.com/api/auto-replies/ar-1/stop')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-1')
    expect(JSON.parse(String(init.body))).toEqual({ reason: '一時停止' })
  })
})
