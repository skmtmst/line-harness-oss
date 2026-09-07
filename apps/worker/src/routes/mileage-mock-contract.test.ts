import { describe, expect, it } from 'vitest'
// @ts-expect-error -- 画面確認の固定応答は Node 実行用 .mjs で型宣言を持たない。
import { mileageWriteResponse } from '../../../../scripts/visual-qa/fixtures.mjs'

describe('機能17の画面確認モック', () => {
  it('マイルルールは成功・入力不足・旧共通ルール競合を区別する', () => {
    expect(mileageWriteResponse('POST', '/api/mileage/rules', {
      name: '来店', eventType: 'visit', amount: 10, lineAccountId: 'visual-qa-account',
    })?.status).toBe(201)
    expect(mileageWriteResponse('POST', '/api/mileage/rules', {})?.status).toBe(400)
    expect(mileageWriteResponse('PUT', '/api/mileage/rules/mileage-rule-global', { amount: 10 })?.status).toBe(409)
  })

  it('使い道のテスト・公開・停止を本番と同じ器で返す', () => {
    for (const operation of ['test', 'publish', 'stop']) {
      const response = mileageWriteResponse('POST', `/api/mileage/rewards/mr-1/${operation}`, {
        accountId: 'visual-qa-account',
      })
      expect(response).toMatchObject({ status: 200, body: { success: true } })
    }
    expect(mileageWriteResponse('POST', '/api/mileage/rewards/mr-1/test', {})?.status).toBe(400)
    expect(mileageWriteResponse('POST', '/api/mileage/rewards/mr-conflict/publish', {
      accountId: 'visual-qa-account',
    })?.status).toBe(409)
  })

  it('手動調整は再送キーの400・409と成功を区別する', () => {
    const body = {
      accountId: 'visual-qa-account', friendId: 'friend-1', direction: 'increase', amount: 100,
      reason: '問い合わせ対応',
    }
    expect(mileageWriteResponse('POST', '/api/mileage/adjustments', body)?.status).toBe(400)
    expect(mileageWriteResponse('POST', '/api/mileage/adjustments', body, {
      'idempotency-key': 'visual-conflict',
    })?.status).toBe(409)
    expect(mileageWriteResponse('POST', '/api/mileage/adjustments', body, {
      'idempotency-key': 'visual-success',
    })?.status).toBe(201)
  })

  it('行動スコアの下書き・試験・公開・停止を返す', () => {
    const configuration = { rules: [], bands: { min: 0, max: 100, normalMin: 30, highMin: 70 } }
    expect(mileageWriteResponse('PATCH', '/api/action-scores/rules/draft', {
      accountId: 'visual-qa-account', expectedDraftVersionId: null, configuration,
    })?.status).toBe(200)
    expect(mileageWriteResponse('POST', '/api/action-scores/rules/test', {
      accountId: 'visual-qa-account', configuration, currentScore: 40, eventType: 'message_received',
    })?.status).toBe(200)
    expect(mileageWriteResponse('POST', '/api/action-scores/rules/publish', {
      accountId: 'visual-qa-account', draftVersionId: 'stale-version',
    })?.status).toBe(409)
    expect(mileageWriteResponse('POST', '/api/action-scores/rules/stop', {})?.status).toBe(400)
  })
})
