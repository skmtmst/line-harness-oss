import { beforeAll, describe, expect, it, vi } from 'vitest'

let api: typeof import('@/lib/api').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ api } = await import('@/lib/api'))
})

/**
 * #637 N-195 登録メディアのダウンロードは保存URLへ直接行かない。
 * 権限確認と監査を通る口から Blob で受け取る。
 */
describe('登録メディアの認証付きダウンロード', () => {
  it('対象メディアと選択中アカウントを指定して口を叩く', async () => {
    const fetchSpy = vi.fn(async () => new Response('PNGDATA', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const blob = await api.media.download('md/1', 'account/1')

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://worker.example.com/api/media/md%2F1/download?accountId=account%2F1',
    ])
    // GET で Cookie を付けて取りに行く（CSRF 対象の変更操作ではない）。
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
    })
    expect(await blob.text()).toBe('PNGDATA')
  })

  it('権限なしは保存せず呼び出し側へ返す', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, error: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await expect(api.media.download('md-1', 'account-2')).rejects.toThrow()
  })
})
