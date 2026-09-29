import { describe, expect, it } from 'vitest'

import { countText } from './broadcast-kpis'

/**
 * 一覧の帯（設計 `q76C35`）に `undefined` を出さない。
 *
 * 実際に「予約中 undefined」「失敗 undefined」が出ていた。口が想定の形を
 * 返さないと（撮影用のモックに `/api/broadcasts/stats` が無く、別の形が
 * 返っていた）、そのまま文字にして画面へ流していた。
 *
 * 数が無いときは `—` にして、**単位も付けない**。`—件` は数に見える。
 */
describe('帯の副題に出す数', () => {
  it('数があれば桁区切りと単位を付ける', () => {
    expect(countText(1842, '通')).toBe('1,842通')
    expect(countText(0, '件')).toBe('0件')
  })

  it('口が返さなかったときは — にして、単位を付けない', () => {
    expect(countText(undefined, '件')).toBe('—')
    expect(countText(null, '通')).toBe('—')
  })

  /** 文字で返ってきた数を、そのまま画面へ流さない。 */
  it('数でないものは — にする', () => {
    expect(countText('12', '件')).toBe('—')
    expect(countText({ items: [] }, '件')).toBe('—')
  })

  /** 0除算などで NaN / Infinity が来ることがある。画面には出さない。 */
  it('NaN と Infinity も — にする', () => {
    expect(countText(Number.NaN, '%')).toBe('—')
    expect(countText(Number.POSITIVE_INFINITY, '%')).toBe('—')
  })

  it('どの場合も undefined や NaN を文字として出さない', () => {
    for (const input of [undefined, null, Number.NaN, '12', {}]) {
      const value = countText(input, '件')
      expect(value).not.toContain('undefined')
      expect(value).not.toContain('NaN')
    }
  })
})
