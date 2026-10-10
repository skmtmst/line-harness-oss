import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
let api: typeof import('./api')
beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8788'
  api = await import('./api')
})
afterEach(() => vi.unstubAllGlobals())
describe('B-154 APIの欄ごとの理由', () => {
  it.each([400, 422])('%iの保存失敗をApiError.fieldsからフォームへ渡せる', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: '入力内容を確認してください', fields: { name: '名前を入力してください', 'steps.0.messageContent': '本文は5,000文字までです' },
    }), { status })))
    const caught = await api.fetchApi('/api/templates', { method: 'POST', body: '{}' }).catch(error => error)
    expect(caught).toBeInstanceOf(api.ApiError)
    expect(caught.message).toBe('入力内容を確認してください')
    expect(api.getApiFieldErrors(caught)).toEqual({ name: '名前を入力してください', 'steps.0.messageContent': '本文は5,000文字までです' })
  })
  it('errorのみの旧APIとネットワーク失敗ではfieldsを空にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '名前を確認してください' }), { status: 400 })))
    const caught = await api.fetchApi('/api/tags', { method: 'POST', body: '{}' }).catch(error => error)
    expect(caught.message).toBe('名前を確認してください')
    expect(api.getApiFieldErrors(caught)).toEqual({})
    expect(api.getApiFieldErrors(new Error('network'))).toEqual({})
  })
  it('400/422以外の本文、内部情報、不正な形は欄へ出さない', () => {
    expect(api.extractApiFieldErrors('{', 400)).toEqual({})
    expect(api.extractApiFieldErrors('{"fields":[]}', 422)).toEqual({})
    expect(api.extractApiFieldErrors('{"fields":{"name":"名前を確認してください"}}', 500)).toEqual({})
    expect(api.extractApiFieldErrors(JSON.stringify({ fields: { name: '名前を確認してください', invalid: 1,
      sql: 'D1_ERROR: SELECT secret FROM users', token: 'token=secret-value', html: '<script>alert(1)</script>' } }), 422)).toEqual({ name: '名前を確認してください' })
  })
})
