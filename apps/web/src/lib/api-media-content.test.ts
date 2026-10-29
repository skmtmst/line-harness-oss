import { afterEach, beforeAll, expect, it, vi } from 'vitest'

let api: typeof import('./api').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ api } = await import('./api'))
})
afterEach(() => vi.unstubAllGlobals())

it('切り取り用画像は追加本人確認が必要な download ではなく認証付き content から取得する', async () => {
  const fetchSpy = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/jpeg' })))
  vi.stubGlobal('fetch', fetchSpy)

  await expect(api.media.readContent('media/1', 'account/1')).resolves.toBeInstanceOf(Blob)
  expect(fetchSpy).toHaveBeenCalledWith(
    'https://worker.example.com/api/media/media%2F1/content?accountId=account%2F1',
    expect.objectContaining({ credentials: 'include' }),
  )
})
