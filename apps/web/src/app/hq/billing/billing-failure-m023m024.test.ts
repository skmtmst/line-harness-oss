import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ApiError } from '@/lib/api'
import { BILLING_UNREACHABLE, billingFailureMessage } from './failure-message'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const PAGE = read('../../../v8/hq/billing.tsx')

/**
 * M023：Stripe への輸送失敗は内部文を出さず、決済サービスの案内にする。
 * M024：ポータル失敗の汎用文に再試行の言葉を足す。
 */
describe('M023/M024 課金の失敗表示', () => {
  it('502（決済サービス不通）は決済サービスの案内になる', () => {
    expect(billingFailureMessage(new ApiError(502, 'API error: 502'), '支払い方法の管理画面の表示', 'forbidden-text'))
      .toBe(BILLING_UNREACHABLE)
  })

  it('403 は権限の案内になる', () => {
    expect(billingFailureMessage(new ApiError(403, 'API error: 403'), '支払い方法の管理画面の表示', 'forbidden-text'))
      .toBe('この操作の権限がありません。統括の管理者に頼んでください。')
  })

  it('通信断は再試行の言葉つきの案内になる', () => {
    const message = billingFailureMessage(new TypeError('Failed to fetch'), '支払い方法の管理画面の表示', 'forbidden-text')
    expect(message).toContain('もう一度お試しください')
    expect(message).not.toContain('API error')
  })

  it('申込・ポータルの失敗を原文の代替文へ戻さない（共通の案内へ渡すことは billing-flow-react が描いて見る）', () => {
    expect(PAGE).not.toContain("caught.message : '支払い方法の管理画面へ進めませんでした。'")
  })
})
