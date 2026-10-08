import { describe, expect, it, vi, afterEach } from 'vitest'
// @ts-expect-error JS tool
import { stubApi, installStressApi, measureScreen, assertStressResponse, screenReady } from '../../apps/web/scripts/v8-guard/speed-budget.mjs'

type Handler = (route: unknown) => Promise<void>
function routingPage() {
  const handlers: Handler[] = []
  return {
    route: async (_pattern: string, handler: Handler) => { handlers.push(handler) },
    async request() {
      let answer: { body: string; status: number } | null = null
      const route = { request: () => ({ url: () => 'http://api.test/api/friends?limit=20', method: () => 'GET' }), fulfill: async (value: typeof answer) => { answer = value } }
      await handlers[handlers.length - 1](route)
      return answer as unknown as { body: string; status: number }
    },
  }
}
const mockFetch = async () => ({ status: 200, body: JSON.stringify({ success: true, data: { items: [{ id: 'f1' }], total: 1 } }) })

describe('WEB236 速度検査の成立条件', () => {
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
      goto: async () => {},
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
    ['読み込めませんでした', 'error', false, 'error'],
    ['読込中', 'loading', false, false],
    ['全20人中', null, true, false],
    ['全2,000人中', null, true, true],
  ])('表示 %s の判定', (text, state, hasRow, expected) => {
    vi.stubGlobal('document', { documentElement: { dataset: { theme: 'v8' } }, querySelector: () => ({
      textContent: text, querySelector: (selector: string) => selector.includes('error') ? state === 'error' : selector.includes('loading') ? state === 'loading' : hasRow,
    }) })
    expect(screenReady({ route: '/friends', expectedRows: 2000 })).toBe(expected)
  })
})
