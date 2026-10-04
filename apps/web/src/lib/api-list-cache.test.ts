import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

let readCachedList: typeof import('./api').readCachedList
let refreshCachedList: typeof import('./api').refreshCachedList

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ readCachedList, refreshCachedList } = await import('./api'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('一覧の取り方（前を出して裏で取り直す）', () => {
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
