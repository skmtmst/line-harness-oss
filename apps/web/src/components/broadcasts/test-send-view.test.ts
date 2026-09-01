import { describe, expect, it } from 'vitest'

import { testSendFailure, testSendResult } from './test-send-view'

describe('一斉配信のテスト送信結果', () => {
  it('全員へ送れたときだけ成功にする', () => {
    expect(testSendResult(2, 0, '10:00')).toEqual({
      kind: 'success',
      message: '10:00 テスト送信済み (2名成功)',
    })
  })

  it('一部失敗を成功色へ混ぜない', () => {
    expect(testSendResult(1, 1, '10:00')).toEqual({
      kind: 'partial',
      message: '10:00 一部を送信できませんでした (1名成功, 1名失敗)',
    })
  })

  it('成功応答でも0名なら送信済みにしない', () => {
    expect(testSendResult(0, 0, '10:00').kind).toBe('error')
  })

  it('API失敗を運用者の言葉にする', () => {
    expect(testSendFailure('10:00')).toEqual({
      kind: 'error',
      message: '10:00 テスト送信に失敗しました',
    })
  })
})
