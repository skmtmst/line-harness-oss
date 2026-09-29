// @vitest-environment happy-dom
/*
 * Issue #703: 権限・機能 off でプール管理を開いても
 * GET /api/traffic-pools を発行しない（403 が console error になるため）。
 * 無効と確定したら共通ゲートと同じ案内を直接出し、
 * 有効なら従来どおり一覧を出す。
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let PoolsPage: typeof import('./page').default
let clearFeatureVisibilityCache: typeof import('@/lib/feature-visibility-cache').clearFeatureVisibilityCache

const seenPaths: string[] = []
let features: Record<string, boolean> = {}

function stubFetch() {
  seenPaths.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const parsed = new URL(url)
    seenPaths.push(parsed.pathname)
    if (parsed.pathname === '/api/line-accounts') {
      return new Response(JSON.stringify({ success: true, data: [{ id: 'acc-1', name: '本店' }] }), { status: 200 })
    }
    if (parsed.pathname === '/api/settings/features/visibility') {
      return new Response(JSON.stringify({ success: true, data: { features } }), { status: 200 })
    }
    if (parsed.pathname === '/api/traffic-pools') {
      return new Response(JSON.stringify({
        success: true,
        data: [{
          id: 'pool-1', slug: 'main', name: 'メインプール', activeAccountId: 'acc-1',
          accountName: '本店', liffId: 'liff-1', isActive: true,
          createdAt: '2026-09-01T00:00:00+09:00', updatedAt: '2026-09-01T00:00:00+09:00',
        }],
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
  }))
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ default: PoolsPage } = await import('./page'))
  ;({ clearFeatureVisibilityCache } = await import('@/lib/feature-visibility-cache'))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearFeatureVisibilityCache()
})

describe('プール管理の発行前ゲート（#703）', () => {
  it('どこも無効なら口を発行せず、案内だけ出す', async () => {
    features = { multi_store_hierarchy: false }
    stubFetch()
    const view = render(<PoolsPage />)

    await waitFor(() => {
      expect(view.getByText('この機能は設定でオフになっています')).toBeTruthy()
    })
    expect(view.queryByText('新規プール')).toBeNull()
    expect(view.queryByText('読み込み中...')).toBeNull()
    expect(seenPaths).not.toContain('/api/traffic-pools')
  })

  it('有効なら従来どおり口を呼び、一覧を出す', async () => {
    features = { multi_store_hierarchy: true }
    stubFetch()
    const view = render(<PoolsPage />)

    await waitFor(() => expect(view.getByText('メインプール')).toBeTruthy())
    expect(view.getAllByText(/プールをつくる/)[0]).toBeTruthy()
    expect(seenPaths).toContain('/api/traffic-pools')
  })
})
