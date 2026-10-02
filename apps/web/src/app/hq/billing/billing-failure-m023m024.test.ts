import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ApiError } from '@/lib/api'
import { BILLING_UNREACHABLE, billingFailureMessage } from './failure-message'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

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
      .toBe('forbidden-text')
  })

  it('通信断は再試行の言葉つきの案内になる', () => {
    const message = billingFailureMessage(new TypeError('Failed to fetch'), '支払い方法の管理画面の表示', 'forbidden-text')
    expect(message).toContain('もう一度お試しください')
    expect(message).not.toContain('API error')
  })

  it('申込・ポータルの失敗は共通の案内へ渡す', () => {
    expect(PAGE).toContain('billingFailureMessage(caught')
    expect(PAGE).not.toContain("caught.message : '支払い方法の管理画面へ進めませんでした。'")
  })

  it('履歴の 502 も決済サービスの案内にする', () => {
    expect(PAGE).toContain('invoiceUnreachable')
    expect(PAGE).toContain('決済サービスにつながりませんでした')
  })
})
