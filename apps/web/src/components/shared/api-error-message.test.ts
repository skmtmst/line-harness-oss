import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { classifyApiFailure, describeApiFailure, isForbiddenOrRateLimited, japaneseDetailOf, loadFailureCopy, loadFailureNotice, retryAfterSecondsOf } from './api-error-message'

describe('APIの失敗を原因どおりに言い分ける（R32）', () => {
  it('403は権限不足に分け、統括への依頼を案内する', () => {
    const err = new ApiError(403, 'API error: 403')
    expect(classifyApiFailure(err)).toBe('forbidden')
    expect(describeApiFailure(err, '作成')).toContain('統括')
    expect(describeApiFailure(err, '作成')).not.toContain('通信')
  })

  it('呼び出し側の指定で403の案内を変えられる', () => {
    const err = new ApiError(403, 'API error: 403')
    expect(describeApiFailure(err, '作成', { forbidden: '受け取り口の作成は統括だけができます。' }))
      .toBe('受け取り口の作成は統括だけができます。')
  })

  it('400/422は入力の直しに分け、欄の下と組み合わせられる', () => {
    for (const status of [400, 422]) {
      const err = new ApiError(status, '名前を入力してください')
      expect(classifyApiFailure(err)).toBe('invalid')
      expect(describeApiFailure(err, '作成')).toContain('入力を直してください')
      expect(describeApiFailure(err, '作成')).not.toContain('通信')
    }
  })

  it('英語の検証文はそのまま出さず、欄の直し方へ回す', () => {
    const err = new ApiError(400, 'secret must be at least 32 characters')
    expect(japaneseDetailOf(err)).toBe('')
    expect(describeApiFailure(err, '作成')).toBe('入力を直してください。')
  })

  it('404は見つからないに分け、開き直しを案内する', () => {
    const err = new ApiError(404, 'API error: 404')
    expect(classifyApiFailure(err)).toBe('missing')
    expect(describeApiFailure(err, '作成')).toContain('開き直してください')
  })

  it('通信の切断と5xxはもう一度に分け、失敗の立て直し方まで書く', () => {
    expect(classifyApiFailure(new TypeError('Failed to fetch'))).toBe('retryable')
    expect(classifyApiFailure(new ApiError(500, 'API error: 500'))).toBe('retryable')
    const message = describeApiFailure(new ApiError(500, 'API error: 500'), '作成')
    expect(message).toContain('作成に失敗しました')
    expect(message).toContain('もう一度お試しください')
  })

  it('401・409は既存の言い方（describeSaveFailure）に寄せる', () => {
    expect(describeApiFailure(new ApiError(401, 'API error: 401'), '作成')).toContain('ログイン')
    expect(describeApiFailure(new ApiError(409, 'API error: 409'), '作成')).not.toContain('通信を確かめて')
  })

  it('429は混み合いに分け、待ち秒数があれば添える', () => {
    expect(classifyApiFailure(new ApiError(429, 'API error: 429'))).toBe('rateLimited')
    expect(describeApiFailure(new ApiError(429, 'API error: 429', undefined, undefined, undefined, 30), '読み込み'))
      .toContain('30秒')
    expect(describeApiFailure(new ApiError(429, 'API error: 429', undefined, undefined, undefined, 30), '読み込み'))
      .toContain('混み合')
    expect(describeApiFailure(new ApiError(429, 'API error: 429'), '読み込み')).toContain('少し待って')
    expect(describeApiFailure(new ApiError(429, 'API error: 429'), '読み込み')).not.toContain('通信')
  })

  it('dataの運び屋の待ち秒数（retryAfterSeconds）も読む', () => {
    const err = new ApiError(429, 'API error: 429', undefined, { retryAfterSeconds: 90 })
    expect(retryAfterSecondsOf(err)).toBe(90)
    expect(describeApiFailure(err, '読み込み')).toContain('90秒')
    expect(retryAfterSecondsOf(new ApiError(429, 'API error: 429'))).toBeUndefined()
    expect(retryAfterSecondsOf(new ApiError(500, 'API error: 500'))).toBeUndefined()
  })
})

describe('読み込み失敗の1枚（403・429の出し分け）', () => {
  it('403は権限の1枚にし、再試行は出さない', () => {
    const view = loadFailureCopy(new ApiError(403, 'API error: 403'), 'この画面')
    expect(view.title).toContain('権限がありません')
    expect(view.description).toContain('権限')
    expect(view.retryable).toBe(false)
  })

  it('429は混み合いの1枚にし、待ち秒数を添えて再試行は残す', () => {
    const view = loadFailureCopy(new ApiError(429, 'API error: 429', undefined, undefined, undefined, 30), 'この画面')
    expect(view.title).toContain('混み合')
    expect(view.description).toContain('30秒')
    expect(view.retryable).toBe(true)
  })

  it('429で秒数が無ければ秒数なしの待ち案内にする', () => {
    const view = loadFailureCopy(new ApiError(429, 'API error: 429'), 'この画面')
    expect(view.description).toContain('少し待って')
    expect(view.retryable).toBe(true)
  })

  it('それ以外は今までどおりの1枚にし、再試行は残す', () => {
    const view = loadFailureCopy(new ApiError(500, 'API error: 500'), 'この画面')
    expect(view.title).toContain('表示できませんでした')
    expect(view.retryable).toBe(true)
    expect(loadFailureCopy(new TypeError('Failed to fetch'), 'この画面').retryable).toBe(true)
  })

  it('403・429だけ特別扱いにする目安がある', () => {
    expect(isForbiddenOrRateLimited(new ApiError(403, 'API error: 403'))).toBe(true)
    expect(isForbiddenOrRateLimited(new ApiError(429, 'API error: 429'))).toBe(true)
    expect(isForbiddenOrRateLimited(new ApiError(500, 'API error: 500'))).toBe(false)
    expect(isForbiddenOrRateLimited(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('帯の1行は生の内部文を出さない', () => {
    expect(loadFailureNotice(new ApiError(403, 'API error: 403'), 'この画面'))
      .toContain('権限がありません')
    expect(loadFailureNotice(new ApiError(429, 'API error: 429', undefined, undefined, undefined, 30), 'この画面'))
      .toContain('30秒')
    expect(loadFailureNotice(new ApiError(500, 'API error: 500'), 'この画面'))
      .not.toContain('API error')
  })
})
