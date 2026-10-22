// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hqStyleApi } from './styles'

const ok = () => new Response(JSON.stringify({ success: true, data: { asOf: 'now', items: [] } }))
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'lh_csrf' ? 'fixture-session' : null })
})
afterEach(() => vi.unstubAllGlobals())

it('メニューと画面の同時取得は1本にし、完了後の読み直しは新しく取る', async () => {
  let answer!: (res: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { answer = resolve }))
    .mockImplementation(() => Promise.resolve(ok()))
  vi.stubGlobal('fetch', fetch)
  const menu = hqStyleApi.attention()
  const page = hqStyleApi.attention()
  expect(fetch).toHaveBeenCalledTimes(1)
  answer(ok())
  const [a, b] = await Promise.all([menu, page])
  expect(a).toEqual(b)
  expect(a.data).not.toBe(b.data)
  await hqStyleApi.attention()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('失敗は保持せず、認証世代が違う取得も共有しない', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"error":"down"}', { status: 503 }))
    .mockImplementation(() => Promise.resolve(ok()))
  vi.stubGlobal('fetch', fetch)
  expect((await Promise.allSettled([hqStyleApi.attention(), hqStyleApi.attention()])).map(r => r.status))
    .toEqual(['rejected', 'rejected'])
  // サーバー失敗の報告APIは、対象の読取数に数えない。
  const attentionCalls = () => fetch.mock.calls.filter(([path]) => String(path).endsWith('/api/hq/style-attention'))
  expect(attentionCalls()).toHaveLength(1)
  await hqStyleApi.attention()
  expect(attentionCalls()).toHaveLength(2)
  let csrf = 'a'
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'lh_csrf' ? csrf : null })
  const a = hqStyleApi.attention()
  csrf = 'b'
  const b = hqStyleApi.attention()
  await Promise.all([a, b])
  expect(attentionCalls()).toHaveLength(4)
})
