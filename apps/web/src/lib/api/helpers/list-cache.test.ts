// @vitest-environment happy-dom
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { clearApiReadCache } from '../transport/read-cache'

let readCachedList: typeof import('../../api').readCachedList
let fetchApi: typeof import('../../api').fetchApi
let refreshCachedList: typeof import('../../api').refreshCachedList

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ readCachedList, refreshCachedList, fetchApi } = await import('../../api'))
})

beforeEach(() => { localStorage.clear(); localStorage.setItem('lh_csrf', 'fixture-session') })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('一覧の取り方（前を出して裏で取り直す）', () => {
  it('店舗・認証・保存の世代が変われば、ETagの本文も破棄する', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"success":true,"data":[]}', { headers: { ETag: 'old' } }))
    vi.stubGlobal('fetch', fetchSpy)
    for (const change of ['account', 'csrf', 'mutation', 'invalidate']) {
      await refreshCachedList('/api/tags')
      expect(readCachedList('/api/tags')).not.toBeNull()
      if (change === 'account') localStorage.setItem('lh_selected_account', 'other')
      if (change === 'csrf') localStorage.setItem('lh_csrf', 'other-session')
      if (change === 'mutation') await fetchApi('/api/tags/tag-a', { method: 'PATCH' })
      if (change === 'invalidate') clearApiReadCache()
      expect(readCachedList('/api/tags')).toBeNull()
    }
  })

  it('失効前の遅い応答と失敗応答を再利用しない', async () => {
    let finish!: (response: Response) => void
    const fetchSpy = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
      .mockResolvedValueOnce(new Response('{"success":false}'))
    vi.stubGlobal('fetch', fetchSpy)
    const pending = refreshCachedList('/api/tags')
    clearApiReadCache()
    finish(new Response('{"success":true,"data":[]}'))
    await pending
    expect(readCachedList('/api/tags')).toBeNull()
    await refreshCachedList('/api/tags')
    expect(readCachedList('/api/tags')).toBeNull()
  })

  it('覚えがなければ取りに行き、次はETagで304なら覚えていた分を返す', async () => {
    const body = { success: true, data: [{ id: 'tag-1' }] }
    const fetchSpy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const noneMatch = (init?.headers as Record<string, string>)?.['If-None-Match']
      if (noneMatch === 'W/"abc123"') return new Response(null, { status: 304 })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', ETag: 'W/"abc123"' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)

    expect(readCachedList('/api/tags')).toBeNull()
    await expect(refreshCachedList('/api/tags')).resolves.toEqual(body)
    expect(readCachedList('/api/tags')).toEqual(body)
    await expect(refreshCachedList('/api/tags')).resolves.toEqual(body)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'If-None-Match': 'W/"abc123"' }),
    })
  })

  it('中身が変われば新しい分に入れ替える', async () => {
    const first = { success: true, data: [{ id: 'tag-1' }] }
    const second = { success: true, data: [{ id: 'tag-1' }, { id: 'tag-2' }] }
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        const payload = calls === 1 ? first : second
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json', ETag: `W/"v${calls}"` },
        })
      }),
    )
    await expect(refreshCachedList('/api/tags')).resolves.toEqual(first)
    await expect(refreshCachedList('/api/tags')).resolves.toEqual(second)
    expect(readCachedList('/api/tags')).toEqual(second)
  })
})
