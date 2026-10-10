import { describe, expect, it, vi, afterEach } from 'vitest'
// @ts-expect-error JS tool
import { stubApi, installStressApi, measureScreen, assertStressResponse, screenReady, waitForScreenReady } from '../../apps/web/scripts/v8-guard/speed-budget.mjs'

type Handler = (route: unknown) => Promise<void>
function routingPage() {
  const handlers: Handler[] = []
  return {
    route: async (_pattern: string, handler: Handler) => { handlers.push(handler) },
    async request() {
      let answer: { body: string; status: number; headers: Record<string, string> } | null = null
      const route = { request: () => ({ url: () => 'http://api.test/api/friends?limit=20', method: () => 'GET', headers: () => ({ origin: 'http://web.test' }) }), fulfill: async (value: typeof answer) => { answer = value } }
      await handlers[handlers.length - 1](route)
      return answer as unknown as { body: string; status: number; headers: Record<string, string> }
    },
  }
}
const mockFetch = async () => ({ status: 200, body: JSON.stringify({ success: true, data: { items: [{ id: 'f1' }], total: 1 } }) })

describe('WEB236 速度検査の成立条件', () => {
  it('負荷画面の待ち時間を延ばしても、2,000行の完了印を必須にする', async () => {
    const calls: unknown[] = []
    const page = { waitForFunction: async (_fn: unknown, arg: unknown, options: unknown) => {
      calls.push([arg, options])
      return { jsonValue: async () => true }
    } }
    await waitForScreenReady(page, '/friends', 2000)
    await waitForScreenReady(page, '/friends')
    expect(calls).toEqual([
      [{ route: '/friends', expectedRows: 2000 }, { timeout: 180000 }],
      [{ route: '/friends', expectedRows: null }, { timeout: 15000 }],
    ])
  })
  it('PlaywrightのRequest.url()を呼んでモックに渡す', async () => {
    const page = routingPage()
    let path = ''
    await stubApi(page, async (_method: string, url: string) => { path = url; return mockFetch() })
    await page.request()
    expect(path).toBe('/api/friends?limit=20')
  })
  it('一般APIのrouteが後から2,000行のrouteを遮らない', async () => {
    const page = routingPage()
    await installStressApi(page, { stub: true, mockFetch })
    const answer = await page.request()
    const { data } = JSON.parse(answer.body)
    expect(data.items).toHaveLength(2000)
    expect(data.total).toBe(2000)
  })
  it.each(['stub', 'stress'])('通信差し替えでもログイン情報付き通信の CORS を守る（%s）', async (kind) => {
    const page = routingPage()
    if (kind === 'stub') await stubApi(page, mockFetch)
    else await installStressApi(page, { stub: true, mockFetch })
    expect((await page.request()).headers).toMatchObject({
      'Access-Control-Allow-Origin': 'http://web.test',
      'Access-Control-Allow-Credentials': 'true',
    })
  })
  it('元データの取得失敗を2,000行にしない', async () => {
    const page = routingPage()
    const state = await installStressApi(page, { stub: true, mockFetch: async () => ({ status: 500, body: '{}' }) })
    expect((await page.request()).status).toBe(500)
    expect(() => assertStressResponse(state)).toThrow(/HTTP 500/)
    expect(() => assertStressResponse({ rows: 0, error: null })).toThrow(/実際 0行/)
  })
  it.each(['error', 'timeout'])('mainが出ても読込%sなら速度値にしない', async state => {
    const page = {
      addInitScript: async () => {},
      goto: async (_url: string, options: { waitUntil: string }) => { expect(options.waitUntil).toBe('networkidle') },
      locator: () => ({ first: () => ({ waitFor: async () => {}, count: async () => 0 }) }),
      waitForFunction: async () => { if (state === 'timeout') throw new Error('timeout'); return { jsonValue: async () => 'error' } },
      evaluate: async (fn: () => unknown) => String(fn).includes('jsBytes') ? { jsBytes: 0, longTaskMs: 0 } : null,
      close: async () => {},
    }
    const browser = { newPage: async () => page }
    await expect(measureScreen(browser, { stub: false, url: () => 'http://web.test/friends' }, 'friends', '/friends')).rejects.toThrow()
  })
})

// 読み込み判定そのものを動かし、エラー・空表示で合格しないことを守る。
afterEach(() => vi.unstubAllGlobals())
describe('実際の画面の成立条件', () => {
  it.each([
    ['読み込めませんでした', 'error', 2000, 'error'],
    ['読込中', 'loading', 2000, false],
    ['全2,000人中', null, 20, false],
    ['2,000件中 1〜20件を表示', null, 2000, true],
    ['表示の言葉を変えても完了', null, 2000, true],
    ['表示済み', null, 1999, false],
    ['表示済み', null, 0, false],
  ])('表示 %s / 実際 %s 行の判定', (text, state, rows, expected) => {
    vi.stubGlobal('document', { documentElement: { dataset: { theme: 'v8' } }, querySelector: () => ({
      textContent: text,
      querySelectorAll: () => ({ length: rows }),
      querySelector: (selector: string) => selector.includes('error') ? state === 'error' : selector.includes('loading') ? state === 'loading' : rows > 0,
    }) })
    expect(screenReady({ route: '/friends', expectedRows: 2000 })).toBe(expected)
  })
})
