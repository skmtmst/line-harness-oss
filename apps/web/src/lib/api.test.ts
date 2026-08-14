import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

let fetchApi: typeof import('./api').fetchApi
let ApiError: typeof import('./api').ApiError
let extractApiErrorMessage: typeof import('./api').extractApiErrorMessage

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ fetchApi, ApiError, extractApiErrorMessage } = await import('./api'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractApiErrorMessage', () => {
  it('error を優先して取り出す', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: '入力してください' }))).toBe(
      '入力してください',
    )
  })

  it('error が無ければ message を使う', () => {
    expect(extractApiErrorMessage(JSON.stringify({ message: '権限がありません' }))).toBe(
      '権限がありません',
    )
  })

  it('JSON でない本文は表示に使わない', () => {
    expect(extractApiErrorMessage('<html>internal details</html>')).toBe('')
  })

  it('空の本文を許容する', () => {
    expect(extractApiErrorMessage('')).toBe('')
  })

  it('error が文字列でない場合は使わない', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: { code: 500 } }))).toBe('')
  })
})

describe('fetchApi error response', () => {
  it('Worker の具体的な error を管理画面へ伝える', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: 'ページ「基本メニュー」のタップ領域1: 送信テキストを入力してください',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    ))

    await expect(fetchApi('/api/rich-menu-groups/example/publish', { method: 'POST' }))
      .rejects.toThrow('ページ「基本メニュー」のタップ領域1: 送信テキストを入力してください')
  })

  it('具体的な error を出しても status で分岐できる状態を保つ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: '送信テキストを入力してください' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    // ApiError.status に依存している既存の呼び出し元を壊さないこと。
    await expect(fetchApi('/api/example', { method: 'POST' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
    })
    expect(new ApiError(401).message).toBe('API error: 401')
  })

  it('予期しない本文は表示せず status にフォールバックする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>internal details</html>', { status: 502 }),
    ))

    await expect(fetchApi('/api/example')).rejects.toThrow('API error: 502')
  })
})
