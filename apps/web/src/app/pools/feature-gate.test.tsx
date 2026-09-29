// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let PoolsPage: typeof import('./page').default
let FeatureDisabledGate: typeof import('@/components/feature-disabled-gate').default

beforeAll(async () => {
  // api.ts は import 時に環境変数を要求するので、先に立ててから動的に読む。
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ default: PoolsPage } = await import('./page'))
  ;({ default: FeatureDisabledGate } = await import('@/components/feature-disabled-gate'))
})

function stubFetch(handler: (path: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return handler(new URL(url).pathname)
  }))
}

const FEATURE_OFF = () => new Response(JSON.stringify({
  success: false,
  error: 'この機能は設定でオフになっています',
  code: 'FEATURE_DISABLED',
  featureId: 'multi_store_hierarchy',
}), { status: 403 })

describe('プール管理の直URL(#860)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('機能offでAPIが403 FEATURE_DISABLEDを返すと、共通ゲートが機能設定への案内へ切り替える', async () => {
    stubFetch((path) => path.startsWith('/api/traffic-pools')
      ? FEATURE_OFF()
      : new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))

    const view = render(
      <FeatureDisabledGate><PoolsPage /></FeatureDisabledGate>,
    )

    await waitFor(() => {
      expect(view.getByText('この機能は設定でオフになっています')).toBeTruthy()
      expect(view.getByText('機能設定を開く')).toBeTruthy()
    })
    // プールの管理UIは出ない（読み込み中にも留まらない）。
    expect(view.queryByText('＋ プールをつくる')).toBeNull()
    expect(view.queryByText('まだプールがありません')).toBeNull()
    expect(view.queryByText('読み込んでいます')).toBeNull()
    expect(view.container.querySelector('[data-feature-disabled="multi_store_hierarchy"]')).toBeTruthy()
  })

  it('機能onなら通常どおり一覧と新規作成口を出す', async () => {
    stubFetch((path) => {
      if (path === '/api/traffic-pools') {
        return new Response(JSON.stringify({
          success: true,
          data: [{
            id: 'pool-1',
            slug: 'main',
            name: 'メインプール',
            activeAccountId: 'account-1',
            accountName: '本店',
            liffId: 'liff-1',
            isActive: true,
            createdAt: '2026-09-01T00:00:00+09:00',
            updatedAt: '2026-09-01T00:00:00+09:00',
          }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
    })

    const view = render(
      <FeatureDisabledGate><PoolsPage /></FeatureDisabledGate>,
    )

    await waitFor(() => expect(view.getByText('メインプール')).toBeTruthy())
    expect(view.getByText('＋ プールをつくる')).toBeTruthy()
    expect(view.queryByText('この機能は設定でオフになっています')).toBeNull()
  })
})
