import { describe, expect, it } from 'vitest'
import { canSave, capacityError, stoppedAt, toSteps, type VerifyResult } from './connection-check-view'

const messages = ['トークン発行', '公式アカウント取得', 'Webhook設定', 'LIFF作成', '認証判定']
const result = (failedAt?: number): VerifyResult => ({
  steps: messages.map((message, index) => ({
    order: index + 1,
    message,
    state: failedAt === index + 1 ? 'failed' : failedAt && index + 1 > failedAt ? 'skipped' : 'passed',
  })),
})

describe('V6 33-2 保存する前の5段接続確認', () => {
  it('確かめる前は5段とも「確かめていません」', () => {
    const steps = toSteps(null)
    expect(steps).toHaveLength(5)
    expect(steps.every((item) => item.state === 'skipped')).toBe(true)
  })

  it('止まった段より後ろは未確認のままにする', () => {
    const steps = toSteps(result(3))
    expect(steps.slice(0, 2).every((item) => item.state === 'passed')).toBe(true)
    expect(steps[2].state).toBe('failed')
    expect(steps.slice(3).every((item) => item.state === 'skipped')).toBe(true)
    expect(stoppedAt(steps)?.order).toBe(3)
  })

  it('5段すべて通ったときだけ保存できる', () => {
    expect(canSave(toSteps(result()))).toBe(true)
    expect(canSave(toSteps(result(5)))).toBe(false)
    expect(canSave(toSteps(null))).toBe(false)
  })

  it('警告の数は上限より大きくできない', () => {
    expect(capacityError('50000', '45000')).toBeNull()
    expect(capacityError('50000', '60000')).toBe('上限より大きい数は入れられません。')
  })
})
