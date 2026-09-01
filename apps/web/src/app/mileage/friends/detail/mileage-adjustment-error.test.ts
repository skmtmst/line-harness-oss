import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { mileageAdjustmentErrorMessage } from './mileage-adjustment-dialog'

describe('手動マイル調整の失敗案内', () => {
  it('入力不備だけはWorkerが返した直し方を表示する', () => {
    expect(mileageAdjustmentErrorMessage(new ApiError(400, '残高を超えて減らすことはできません')))
      .toBe('残高を超えて減らすことはできません')
  })

  it.each([
    [403, 'マイルを変更する権限がありません。'],
    [404, '対象の友だちまたはLINEアカウントを確認できませんでした。'],
    [405, 'この環境ではマイル変更を実行できません。'],
    [409, '同じ操作との競合を確認しました。画面を読み直してからやり直してください。'],
    [428, '確認手順が完了していません。画面を閉じずに、もう一度内容を確認してください。'],
  ])('HTTP %iを運用者向けの言葉へ置き換える', (status, expected) => {
    expect(mileageAdjustmentErrorMessage(new ApiError(status))).toBe(expected)
  })

  it('サーバー内部の文と通信エラーをそのまま表示しない', () => {
    expect(mileageAdjustmentErrorMessage(new ApiError(500, 'Internal server error')))
      .toBe('マイルを変更できませんでした。時間をおいてもう一度お試しください。')
    expect(mileageAdjustmentErrorMessage(new Error('Failed to fetch')))
      .toBe('通信に失敗しました。接続を確認してもう一度お試しください。')
    expect(mileageAdjustmentErrorMessage(null)).toBe('通信に失敗しました。')
  })
})
