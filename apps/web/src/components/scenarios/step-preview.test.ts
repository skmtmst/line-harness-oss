/*
 * 1通目のプレビューが出す「届く日時」。
 *
 * ここがずれると、画面に出ている日時と実際の配信が食い違う。設定を疑って
 * 探し回ることになるので、worker の computeNextDeliveryAt と同じ扱いに
 * そろえてある。特に「時刻で指定」で、その日の配信時刻をもう過ぎている
 * ときの繰り上がりを見る。
 */
import { describe, it, expect } from 'vitest'
import { computeDeliveryAt } from './step-preview'

/** JSTの日時をローカルのDateとして組み立てる（画面側と同じ扱い）。 */
function at(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0)
}

describe('時刻で指定', () => {
  it('0日後で、まだ配信時刻を過ぎていなければ当日', () => {
    const out = computeDeliveryAt(at(2026, 8, 19, 8, 30), 'absolute_time', 0, '10:00', 0)
    expect(out.getDate()).toBe(19)
    expect(out.getHours()).toBe(10)
  })

  it('0日後で、配信時刻をもう過ぎていれば翌日', () => {
    // 11:00 に購読開始 → その日の 10:00 は過ぎている
    const out = computeDeliveryAt(at(2026, 8, 19, 11, 0), 'absolute_time', 0, '10:00', 0)
    expect(out.getDate()).toBe(20)
    expect(out.getHours()).toBe(10)
  })

  it('1日後は、購読開始の翌日の決めた時刻', () => {
    const out = computeDeliveryAt(at(2026, 8, 19, 23, 50), 'absolute_time', 1, '10:00', 0)
    expect(out.getMonth() + 1).toBe(8)
    expect(out.getDate()).toBe(20)
    expect(out.getHours()).toBe(10)
    expect(out.getMinutes()).toBe(0)
  })

  it('月をまたいでも正しい日になる', () => {
    const out = computeDeliveryAt(at(2026, 8, 31, 9, 0), 'absolute_time', 1, '10:00', 0)
    expect(out.getMonth() + 1).toBe(9)
    expect(out.getDate()).toBe(1)
  })
})

describe('経過時間で指定', () => {
  it('購読開始からの経過で決まる（時刻はそろわない）', () => {
    const out = computeDeliveryAt(at(2026, 8, 19, 14, 30), 'elapsed', 1, '10:00', 3)
    expect(out.getDate()).toBe(20)
    expect(out.getHours()).toBe(17)
    expect(out.getMinutes()).toBe(30)
  })

  it('0日0時間なら、購読開始と同じ時刻', () => {
    const start = at(2026, 8, 19, 14, 30)
    const out = computeDeliveryAt(start, 'elapsed', 0, '10:00', 0)
    expect(out.getTime()).toBe(start.getTime())
  })

  it('時間が日をまたいでも繰り上がる', () => {
    const out = computeDeliveryAt(at(2026, 8, 19, 22, 0), 'elapsed', 0, '10:00', 5)
    expect(out.getDate()).toBe(20)
    expect(out.getHours()).toBe(3)
  })
})
