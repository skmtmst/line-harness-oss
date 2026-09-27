import { describe, expect, test } from 'vitest'
import {
  reviewActionSummaryText,
  reviewMonitoringText,
  reviewTestSummaryBody,
} from './review-text'
import type { WebinarPublishValidation } from '@/lib/api'

/*
 * R93: 設定サマリーの文言は値に連動する。固定文に戻すと赤くなる。
 */
function validationWith(checks: WebinarPublishValidation['checks']): WebinarPublishValidation {
  return { version: 4, checks, blockers: [], warnings: [] }
}

function passed(key: string) {
  return { key, label: `${key}の札`, status: 'passed' as const, detail: `${key}はそろっています` }
}

function failed(key: string) {
  return { key, label: `${key}の札`, status: 'failed' as const, detail: `${key}が足りません` }
}

describe('reviewActionSummaryText', () => {
  test('検査が無ければ未取得と出す', () => {
    expect(reviewActionSummaryText(null)).toBe('—（未取得）')
  })

  test('視聴後アクションの検査結果をそのまま出す', () => {
    expect(
      reviewActionSummaryText(validationWith([passed('action_dependencies')])),
    ).toBe('action_dependenciesはそろっています')
    expect(
      reviewActionSummaryText(validationWith([{ ...passed('action_dependencies'), detail: '視聴後アクションは未設定です' }])),
    ).toBe('視聴後アクションは未設定です')
  })
})

describe('reviewTestSummaryBody', () => {
  test('両方のテストが通ったときだけ確認済みと出す', () => {
    expect(
      reviewTestSummaryBody(
        validationWith([passed('notification_test'), passed('public_page_test')]), 'ready',
      ),
    ).toBe('公開ページと通知のテスト結果を確認しました。')
  })

  test('終わっていないテストがあるのに確認済みと出さない', () => {
    expect(
      reviewTestSummaryBody(
        validationWith([failed('notification_test'), passed('public_page_test')]), 'ready',
      ),
    ).toBe('通知のテスト送信が終わっていません。')
    expect(
      reviewTestSummaryBody(
        validationWith([failed('notification_test'), failed('public_page_test')]), 'ready',
      ),
    ).toBe('通知のテスト送信・公開ページの確認が終わっていません。')
  })

  test('検査の取得前・失敗時はその状態を出す', () => {
    expect(reviewTestSummaryBody(null, 'loading')).toBe('公開前検査を読み込んでいます。')
    expect(reviewTestSummaryBody(null, 'error')).toContain('公開前検査を取得できませんでした')
  })
})

describe('reviewMonitoringText', () => {
  test('失敗がなければ問題なし、あれば件数を出す', () => {
    expect(reviewMonitoringText(0)).toBe('問題なし')
    expect(reviewMonitoringText(2)).toBe('2件の要確認')
  })
})
