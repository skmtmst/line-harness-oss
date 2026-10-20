import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchApi } from './api'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Workerの日本語の理由を管理画面へ届ける', () => {
  it.each([
    [400, 'ACCOUNT_ID_REQUIRED', 'LINE公式アカウントを選んでください。', 'accountId'],
    [422, 'NAME_MUST_BE_60_CHARACTERS_OR_FEWER', '名前は60文字以下にしてください。', 'name'],
    [404, 'FRIEND_NOT_FOUND', '友だちが見つかりません。一覧から開き直してください。', undefined],
  ] as const)('HTTP %i の理由・コード・欄の理由を保つ', async (status, code, message, field) => {
    const requestId = 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: {
      code, message, requestId, fieldErrors: field ? [{ field, message }] : [],
    } }), { status, headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId } })))
    const error = await fetchApi('/api/test').catch(error => error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, code, message, requestId, fields: field ? { [field]: message } : {} })
  })

  it.each([403, 500, 502, 503])('HTTP %i の外部本文を表示しない守りを保つ', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: {
      code: 'EXTERNAL_FAILURE', message: '顧客 customer@example.invalid の秘密情報',
      requestId: 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0', fieldErrors: [],
    } }), { status })))
    await expect(fetchApi('/api/test')).rejects.toMatchObject({ status, message: `API error: ${status}` })
  })
})
