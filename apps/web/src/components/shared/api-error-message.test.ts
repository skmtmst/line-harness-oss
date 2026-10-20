import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { describeActionFailure } from '@/lib/use-action-error'
import { classifyApiFailure, describeApiFailure, isForbiddenOrRateLimited, japaneseDetailOf, loadFailureCopy, loadFailureNotice, retryAfterSecondsOf } from './api-error-message'

describe('APIの失敗を原因どおりに言い分ける（R32）', () => {
  it('403は権限不足に分け、店舗のオーナーか管理者への依頼を案内する', () => {
    const err = new ApiError(403, 'API error: 403')
    expect(classifyApiFailure(err)).toBe('forbidden')
    expect(describeApiFailure(err, '作成')).toContain('オーナーか管理者に頼んでください')
    expect(describeApiFailure(err, '作成')).not.toContain('通信')
  })

  it('統括では統括の管理者へ頼み、自由な上書きは受け付けない', () => {
    const err = new ApiError(403, 'API error: 403')
    expect(describeApiFailure(err, '作成', { scope: 'hq', forbidden: '受け取り口の作成は統括だけができます。' }))
      .toBe('この操作の権限がありません。統括の管理者に頼んでください。')
  })

  /*
   * 管理者にも渡していない口（要件 v6-33 §15 `account.line.register`「登録、接続確認」）は
   * owner。ここで既定の store のままにすると、管理者が「オーナーか管理者に頼んでください」と
   * 言われ、自分自身に頼む行き止まりになる（2026-10-18 利用者報告）。
   */
  it('オーナーだけの口は、管理者ではなくオーナーへ頼むよう案内する', () => {
    const err = new ApiError(403, 'API error: 403')
    expect(describeApiFailure(err, '接続の確認', { scope: 'owner' }))
      .toBe('この操作の権限がありません。オーナーに頼んでください。')
    expect(describeActionFailure(err, '接続の確認', 'owner'))
      .toBe('この操作の権限がありません。オーナーに頼んでください。')
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

it('決まり6：日本語の403でも画面独自の頼む先へ戻さず、統括の読み込みも同じ文を出す', () => {
  const error = new ApiError(403, '運営へ連絡してください')
  expect(japaneseDetailOf(error)).toBe('')
  expect(describeApiFailure(error, '表示')).toBe('この操作の権限がありません。オーナーか管理者に頼んでください。')
  expect(loadFailureCopy(error, '会員', 'hq')).toMatchObject({ description: 'この操作の権限がありません。統括の管理者に頼んでください。', retryable: false })
})


it('画面内の日本語の検証理由は残し、内部情報や英語の例外は共通の案内にする', () => {
  expect(describeApiFailure(new Error('出す相手の条件を設定してください。'), '公開'))
    .toBe('出す相手の条件を設定してください。')
  for (const raw of ['Failed to fetch', 'SQLITE_ERROR: 保存失敗 SELECT * FROM friends', '<html>サーバーの失敗</html>', '認証失敗 token=private-value', '保存失敗 at handler.ts:12']) {
    const message = describeApiFailure(new Error(raw), '保存')
    expect(message).toBe('保存に失敗しました。時間をおいて、もう一度お試しください。')
    expect(message).not.toContain(raw)
  }
  expect(describeApiFailure(new ApiError(500, '保存失敗 SELECT * FROM friends'), '保存'))
    .toBe('保存に失敗しました。時間をおいて、もう一度お試しください。')
})

it('期限切れの招待は期限と次の操作を残す', () => {
  expect(describeApiFailure(new ApiError(410, 'この招待は期限切れです。招待を送り直してもらってください。'), '招待の確認'))
    .toBe('この招待は期限切れです。招待を送り直してもらってください。')
})
