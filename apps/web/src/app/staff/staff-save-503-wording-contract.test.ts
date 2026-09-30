/*
 * R497-SAVE-WORDING: 保存503の reason 表示（helper 側の契約）。
 *
 * 実配線（見せる範囲の保存catch → describeSaveFailure → dialog/footer）は
 * staff-save-503-wording-react.test.tsx が守る。ここでは本物の helper が
 * 503 を日本語の原因・次の操作へ変えることだけを固定する。
 * 409/step-up/部分権限/idempotency の扱いは変えない。
 */
import { describe, expect, it, beforeAll } from 'vitest'

let ApiError: typeof import('@/lib/api').ApiError
let describeSaveFailure: typeof import('@/lib/api').describeSaveFailure

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ ApiError, describeSaveFailure } = await import('@/lib/api'))
})

describe('R497-SAVE-WORDING 保存503の文言', () => {
  it('本文のない503はサーバー側の失敗として出し、内部文を見せない', () => {
    // 製品の fallback と同じ形（BODY_MESSAGE_STATUSES は 503 を含まない）。
    const text = describeSaveFailure(new ApiError(503))
    expect(text).toContain('サーバー側')
    expect(text).not.toContain('API error')
  })

  it('日本語本文つき503は本文をそのまま出す', () => {
    const body = 'サーバーが混み合っています。時間をおいてお試しください。'
    expect(describeSaveFailure(new ApiError(503, body))).toBe(body)
  })
})
