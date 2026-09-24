// @vitest-environment happy-dom
/*
 * Issue #703: GET /api/traffic-pools の発行前判定。
 * 403 の応答自体がブラウザの console error になるため、
 * どこも有効でないと分かるときは口を発行せず、判定不能のときは
 * 従来どおり呼ぶ（fail-open。サーバが正本）。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let isPoolsFeatureAvailable: typeof import('./pools-availability').isPoolsFeatureAvailable
let clearFeatureVisibilityCache: typeof import('./feature-visibility-cache').clearFeatureVisibilityCache

const seenPaths: string[] = []
let accounts: Array<{ id: string }> = [{ id: 'acc-1' }]
let featuresByAccount: Record<string, Record<string, boolean>> = {}
let failAccounts = false
let failVisibility = false

function stubFetch() {
  seenPaths.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const parsed = new URL(url)
    seenPaths.push(parsed.pathname)
    if (parsed.pathname === '/api/line-accounts') {
      if (failAccounts) return new Response('boom', { status: 500 })
      return new Response(JSON.stringify({ success: true, data: accounts }), { status: 200 })
    }
    if (parsed.pathname === '/api/settings/features/visibility') {
      if (failVisibility) return new Response('boom', { status: 500 })
      const id = parsed.searchParams.get('account_id') ?? ''
      return new Response(
        JSON.stringify({ success: true, data: { features: featuresByAccount[id] ?? {} } }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
  }))
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ isPoolsFeatureAvailable } = await import('./pools-availability'))
  ;({ clearFeatureVisibilityCache } = await import('./feature-visibility-cache'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearFeatureVisibilityCache()
  accounts = [{ id: 'acc-1' }]
  featuresByAccount = {}
  failAccounts = false
  failVisibility = false
})

describe('isPoolsFeatureAvailable（#703）', () => {
  it('どこも off なら false（呼ぶ側は口を発行しない）', async () => {
    featuresByAccount = { 'acc-1': { multi_store_hierarchy: false } }
    stubFetch()
    await expect(isPoolsFeatureAvailable()).resolves.toBe(false)
  })

  it('1か所でも on なら true', async () => {
    accounts = [{ id: 'acc-1' }, { id: 'acc-2' }]
    featuresByAccount = { 'acc-1': { multi_store_hierarchy: false }, 'acc-2': { multi_store_hierarchy: true } }
    stubFetch()
    await expect(isPoolsFeatureAvailable()).resolves.toBe(true)
  })

  it('明示したアカウントだけを見る（line-accounts を呼ばない）', async () => {
    featuresByAccount = { 'acc-9': { multi_store_hierarchy: true } }
    stubFetch()
    await expect(isPoolsFeatureAvailable(['acc-9'])).resolves.toBe(true)
    expect(seenPaths).not.toContain('/api/line-accounts')
    expect(seenPaths).toContain('/api/settings/features/visibility')
  })

  it('可視性が取れないときは true（従来どおり呼び、サーバ・ゲートに任せる）', async () => {
    failVisibility = true
    stubFetch()
    await expect(isPoolsFeatureAvailable()).resolves.toBe(true)
  })

  it('アカウント一覧が取れないときは true', async () => {
    failAccounts = true
    stubFetch()
    await expect(isPoolsFeatureAvailable()).resolves.toBe(true)
  })

  it('アカウントが空のときは true（素朴な応答を「無効」と読み違えない）', async () => {
    accounts = []
    stubFetch()
    await expect(isPoolsFeatureAvailable()).resolves.toBe(true)
  })
})
