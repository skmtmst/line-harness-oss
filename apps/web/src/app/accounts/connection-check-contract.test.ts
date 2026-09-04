import { describe, expect, it } from 'vitest'
import { canSave, capacityError, stoppedAt, toSteps, type VerifyResult } from './connection-check-view'

const result = (over: Partial<VerifyResult> = {}): VerifyResult => ({
  messagingApi: true, webhook: true, lineLogin: true, liff: true,
  webhookUrl: 'https://example/webhook', errors: [],
  ...over,
})

/**
 * 保存する前の接続確認（設計 ★V6 33-2 `b2NGxk`）。
 *
 * **どこかで止まったら保存しない。** 通らないまま保存すると、
 * 「登録できたのに届かない」という一番わかりにくい壊れ方になる。
 */
describe('V6 33-2 保存する前の接続確認', () => {
  it('確かめる前は、4段とも「確かめていません」', () => {
    const steps = toSteps(null)
    expect(steps).toHaveLength(4)
    expect(steps.every((s) => s.state === 'skipped')).toBe(true)
    // **「通りました」を先に出さない。** 押す前から通ったように見せない。
    expect(steps.some((s) => s.state === 'passed')).toBe(false)
  })

  it('止まった段より後ろは「確かめていません」', () => {
    /*
      **後ろを「直してください」にしない。** 直す場所が4つあるように
      見えてしまう。実際に直すのは止まった1つだけ。
    */
    const steps = toSteps(result({ webhook: false }))
    expect(steps[0].state).toBe('passed')
    expect(steps[1].state).toBe('passed')
    expect(steps[2].state).toBe('failed')
    expect(steps[3].state).toBe('skipped')
    expect(stoppedAt(steps)?.order).toBe(3)
  })

  it('1段目で止まったら、2段目以降は確かめない', () => {
    const steps = toSteps(result({ lineLogin: false }))
    expect(steps[0].state).toBe('failed')
    expect(steps.slice(1).every((s) => s.state === 'skipped')).toBe(true)
  })

  it('4段目は、口が無いので「止まった」と言わない', () => {
    /*
      実際に届くかのテストを打つ口はまだ無い。**失敗と書くと、
      直しようのないものを直させることになる。**
    */
    const steps = toSteps(result())
    expect(steps[3].state).toBe('skipped')
    expect(stoppedAt(steps)).toBeNull()
  })

  it('3段目まで通れば保存できる', () => {
    expect(canSave(toSteps(result()))).toBe(true)
    expect(canSave(toSteps(result({ webhook: false })))).toBe(false)
    expect(canSave(toSteps(null))).toBe(false)
  })

  it('警告の数は上限より大きくできない', () => {
    // 大きいと、警告が一度も出ない。
    expect(capacityError('50000', '45000')).toBeNull()
    expect(capacityError('50000', '60000')).toBe('上限より大きい数は入れられません。')
    // 片方だけのときは、まだ言わない。
    expect(capacityError('', '45000')).toBeNull()
    expect(capacityError('50000', '')).toBeNull()
  })
})
