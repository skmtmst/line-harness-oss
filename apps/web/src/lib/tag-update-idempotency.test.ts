import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/*
 * M956: タグ編集の保存に要求キー（Idempotency-Key）を付けて送る。
 * 応答消失後の再送でも、サーバーは保存済みの結果を返す。
 */

let api: typeof import('./api').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ api } = await import('./api'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function okResponse() {
  return new Response(
    JSON.stringify({ success: true, data: { id: 't1', version: 2, queued: 0, replayed: false } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('api.tags.updateDefinition', () => {
  it('要求キーを渡すと Idempotency-Key ヘッダーで送る', async () => {
    const fetchSpy = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchSpy)

    await api.tags.updateDefinition('t1', 'a1', 1, { name: '保存A' }, 'key-1')

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://worker.example.com/api/tags/t1',
    ])
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'Idempotency-Key': 'key-1' }),
    })
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      lineAccountId: 'a1',
      expectedVersion: 1,
      name: '保存A',
    })
  })

  it('要求キー無しでは従来どおりヘッダーを付けない', async () => {
    const fetchSpy = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchSpy)

    await api.tags.updateDefinition('t1', 'a1', 1, { name: '保存A' })

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeUndefined()
  })
})

describe('api.tags.updateArchivedNameAndDescription', () => {
  it('要求キーを渡すと Idempotency-Key ヘッダーで送る', async () => {
    const fetchSpy = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchSpy)

    await api.tags.updateArchivedNameAndDescription('t1', 'a1', 1, { name: '訂正名' }, 'key-2')

    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'Idempotency-Key': 'key-2' }),
    })
  })
})
