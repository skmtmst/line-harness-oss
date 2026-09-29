// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let PoolsPage: typeof import('./page').default

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ default: PoolsPage } = await import('./page'))
})

function stubFetch(handler: (path: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return handler(new URL(url).pathname)
  }))
}

describe('プール管理の空状態', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('0件のときは空状態のボタン1つだけにし、件数と右上の作成口を出さない', async () => {
    stubFetch(() => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))

    const view = render(<PoolsPage />)

    await waitFor(() => expect(view.getByText('まだプールがありません')).toBeTruthy())
    // 緑の作成口は空状態の中の1つだけ。右上と重複しない。
    expect(view.getAllByText('＋ プールをつくる')).toHaveLength(1)
    // 「0 プール」の件数表示は空状態と重複するので出さない。
    expect(view.queryByText('0 プール')).toBeNull()
  })

  it('1件以上あるときは右上に件数と作成口を出す', async () => {
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

    const view = render(<PoolsPage />)

    await waitFor(() => expect(view.getByText('メインプール')).toBeTruthy())
    expect(view.getByText('1 プール')).toBeTruthy()
    expect(view.getByText('＋ プールをつくる')).toBeTruthy()
    expect(view.queryByText('まだプールがありません')).toBeNull()
  })
})
