import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

let fetchApi: typeof import('./api').fetchApi
let ApiError: typeof import('./api').ApiError
let extractApiErrorMessage: typeof import('./api').extractApiErrorMessage
let extractApiErrorCode: typeof import('./api').extractApiErrorCode
let extractApiErrorData: typeof import('./api').extractApiErrorData
let eventsApi: typeof import('./api').eventsApi

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ fetchApi, ApiError, extractApiErrorMessage, extractApiErrorCode, extractApiErrorData, eventsApi } = await import('./api'))
})

describe('eventsApi.createSlots', () => {
  const slots = Array.from({ length: 900 }, (_, index) => ({
    starts_at: new Date(Date.UTC(2099, 0, 1, 0, index)).toISOString(),
    ends_at: new Date(Date.UTC(2099, 0, 1, 0, index + 1)).toISOString(),
    capacity: null,
  }))

  it('900 slots are posted sequentially in 400/400/100 chunks', async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(init?.body as string) as { slots: unknown[] }
      return new Response(JSON.stringify({ items: sent.slots }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await eventsApi.createSlots('account', 'event', slots)

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls.map((call) => JSON.parse(call[1]?.body as string).slots.length)).toEqual([400, 400, 100])
    expect(response.items).toHaveLength(900)
  })

  it('reports how many slots were added when a later chunk fails', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: slots.slice(0, 400) }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(eventsApi.createSlots('account', 'event', slots)).rejects.toThrow('400件まで追加されました')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractApiErrorMessage', () => {
  it('400 では error を優先して取り出す', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: '入力してください' }), 400)).toBe(
      '入力してください',
    )
  })

  it('400 で error が無ければ message を使う', () => {
    expect(extractApiErrorMessage(JSON.stringify({ message: '権限がありません' }), 400)).toBe(
      '権限がありません',
    )
  })

  it('JSON でない本文は表示に使わない', () => {
    expect(extractApiErrorMessage('<html>internal details</html>', 400)).toBe('')
  })

  it('空の本文を許容する', () => {
    expect(extractApiErrorMessage('', 400)).toBe('')
  })

  it('error が文字列でない場合は使わない', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: { code: 500 } }), 400)).toBe('')
  })

  // 表示してよいのは、worker が自分で検証して返した 400 だけ。
  it.each([401, 403, 404, 409, 429, 500, 502, 503])(
    '%i の本文は内部情報を含みうるため表示しない',
    (status) => {
      const body = JSON.stringify({ error: 'D1_ERROR: no such table: rich_menu_groups' })
      expect(extractApiErrorMessage(body, status)).toBe('')
    },
  )
})

describe('extractApiErrorCode', () => {
  it('409のtop-level codeを機械コードとして保持する', () => {
    expect(extractApiErrorCode(JSON.stringify({
      code: 'media_delete_blocked',
      error: '先に使用先から外してください',
    }))).toBe('media_delete_blocked')
  })

  it('内部文言・大文字コード・HTMLは受け取らない', () => {
    expect(extractApiErrorCode(JSON.stringify({ code: 'STALE_PERSON' }))).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ error: 'D1_ERROR: no such table' }))).toBeUndefined()
    expect(extractApiErrorCode('<html>proxy error</html>')).toBeUndefined()
  })
})

describe('extractApiErrorData', () => {
  it('409の最新影響だけを機械処理用に保持する', () => {
    const impact = { usageCount: 2, canDelete: false }
    expect(extractApiErrorData(JSON.stringify({ data: impact }))).toEqual(impact)
    expect(extractApiErrorData('<html>proxy error</html>')).toBeUndefined()
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

  it('メディア削除409の最新影響を保持しても本文は利用者向けメッセージにしない', async () => {
    const impact = {
      usageCount: 2,
      canDelete: false,
      references: [{ name: '8月のお知らせ', state: 'available' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        success: false,
        code: 'media_delete_blocked',
        error: 'このファイルは2か所で使われています。先に使用先から外してください。',
        data: impact,
      }), { status: 409 }),
    ))

    await expect(fetchApi('/api/media/media-1?accountId=account-1', { method: 'DELETE' }))
      .rejects.toMatchObject({
        name: 'ApiError',
        status: 409,
        code: 'media_delete_blocked',
        message: 'API error: 409',
        data: impact,
      })
  })

  it('予期しない本文は表示せず status にフォールバックする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>internal details</html>', { status: 502 }),
    ))

    await expect(fetchApi('/api/example')).rejects.toThrow('API error: 502')
  })

  it('500 の本文は JSON でも表示せず status にフォールバックする', async () => {
    // LINE API 失敗や未処理例外は 500 で返る。内部情報を管理画面へ出さない。
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({ success: false, error: 'LINE API 401: Invalid channel access token' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    ))

    await expect(fetchApi('/api/rich-menu-groups/example/publish', { method: 'POST' }))
      .rejects.toThrow('API error: 500')
  })

  it('認証・CSRF ヘッダーの付与は従来どおり維持される', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', spy)

    await fetchApi('/api/example', { method: 'POST' })

    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})
