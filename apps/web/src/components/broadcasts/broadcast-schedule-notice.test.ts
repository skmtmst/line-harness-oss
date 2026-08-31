import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORM = readFileSync(join(__dirname, 'broadcast-form.tsx'), 'utf8')
const SEND = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'worker', 'src', 'services', 'segment-send.ts'),
  'utf8',
)

/**
 * 送る時間の断り（設計 `vW4Es`）。
 *
 * **書いた内容が本当かを、Workerの実装で確かめる。** 「送るときに数え直す」
 * と画面に書いておいて実際は予約時に固定していたら、逆に嘘になる。
 */
describe('V6 配信前チェック（vW4Es）', () => {
  it('送る相手は送信時に数え直される', () => {
    // 画面の断りの根拠。ここが変わったら断りも書き直す。
    expect(SEND).toContain('buildSegmentQuery(condition)')
    expect(SEND).toContain('export async function processSegmentSend')
  })

  it('選ぶ前に断る', () => {
    /*
      あとから「予約したときと人数が違う」と気づくより先に書く。
      3つの押しボタンより前に置く。
    */
    const section = FORM.slice(FORM.indexOf('3. 送る時間'), FORM.indexOf("setSendMode('now')"))
    expect(section).toContain('送るときにもう一度数え直します')
    expect(section).toContain('予約した時点の数です')
  })

  it('人数が未取得のときに数字を作らない', () => {
    // `targetCount` が null のときは「人数」と書き、0人とは言わない。
    expect(FORM).toContain("targetCount === null ? '人数'")
    expect(FORM).not.toContain('targetCount ?? 0')
  })
})
