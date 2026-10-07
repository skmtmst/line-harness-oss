import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

let api: typeof import('./api').api
beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8788'
  ;({ api } = await import('./api'))
})
afterEach(() => vi.unstubAllGlobals())

describe('友だち情報欄の時刻の呼び出し', () => {
  test('時刻型と既定値を送り、時刻型の返り値を読み取る', async () => {
    const data = { name: '来店時刻', fieldKey: 'visit_time', type: 'time' as const, defaultValue: '09:30' }
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ success: true, data: { id: 'clock', ...data } }), {
      status: 201, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await api.friendFields.create('acc-1', data, 'clock-key')).toMatchObject({ data: { type: 'time', defaultValue: '09:30' } })
    expect(fetchSpy.mock.calls[0]).toEqual([
      'http://127.0.0.1:8788/api/friend-fields?lineAccountId=acc-1',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(data) }),
    ])
  })
})
