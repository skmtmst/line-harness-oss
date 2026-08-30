import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { mileageAdjustmentErrorMessage } from './mileage-adjustment-dialog'

describe('手動マイル調整の失敗案内', () => {
  it('入力不備だけはWorkerが返した直し方を表示する', () => {
    expect(mileageAdjustmentErrorMessage(new ApiError(400, '残高を超えて減らすことはできません')))
      .toBe('残高を超えて減らすことはできません')
  })

  it.each([
    [403, 'マイルを手で変更する権限がありません。'],
    [404, '対象の友だちまたはLINEアカウントを確認できませんでした。'],
    [405, 'この環境ではマイルを手で変更できません。'],
    [409, 'ほかの操作と重なりました。状態を読み直してから、もう一度お試しください。'],
    [428, '確認手順が完了していません。画面を閉じずに、もう一度内容を確認してください。'],
  ])('HTTP %iを運用者向けの言葉へ置き換える', (status, expected) => {
    expect(mileageAdjustmentErrorMessage(new ApiError(status))).toBe(expected)
  })

  it('サーバー内部の文と通信エラーをそのまま表示しない', () => {
    expect(mileageAdjustmentErrorMessage(new ApiError(500, 'Internal server error')))
      .toBe('マイルを変更できませんでした。時間をおいて、もう一度お試しください。')
    expect(mileageAdjustmentErrorMessage(new Error('Failed to fetch')))
      .toBe('通信に失敗しました。接続を確認して、もう一度お試しください。')
  })
})
