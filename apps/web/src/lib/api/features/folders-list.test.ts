import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let api: typeof import('../index').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ api } = await import('../index'))
})

afterEach(() => vi.unstubAllGlobals())

describe('folders.list', () => {
  it('テンプレートのフォルダだけ、今のタブの種類を添えて数えさせる', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)

    await api.folders.list('template', 'account/1', 'question')
    await api.folders.list('template', 'account/1')
    await api.folders.list('tag', 'account/1', 'question')

    expect(fetchSpy.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      'https://worker.example.com/api/folders?kind=template&account_id=account%2F1&section=question',
      'https://worker.example.com/api/folders?kind=template&account_id=account%2F1',
      'https://worker.example.com/api/folders?kind=tag&account_id=account%2F1',
    ])
  })
})
