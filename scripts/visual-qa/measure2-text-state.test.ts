import { describe, expect, it } from 'vitest'
// @ts-expect-error 撮影補助は素のJS。
import { replaceJoinedControlText } from './measure2-text-state.mjs'

describe('同じ押し口の文字の照合', () => {
  it('実際の文字範囲内の断片だけを置き換え、ほかの行・同じ語を残す', () => {
    const texts = [
      { text: '失敗', boxes: [{ x: 100, y: 200, w: 24, h: 17 }, { x: 100, y: 260, w: 24, h: 17 }] },
      { text: '2', boxes: [{ x: 124, y: 200, w: 10, h: 17 }] },
      { text: '有効', boxes: [{ x: 140, y: 200, w: 24, h: 17 }] },
    ]
    const joined = [{ text: '失敗 2', boxes: [{ x: 100, y: 200, w: 34, h: 17 }] }]
    const before = structuredClone(texts)
    expect(replaceJoinedControlText(texts, joined)).toEqual([
      { text: '失敗', boxes: [{ x: 100, y: 260, w: 24, h: 17 }] }, texts[2], joined[0],
    ])
    expect(texts).toEqual(before)
  })
  it('文字を結べないときは元の測りを残し、文字を作り足さない', () => {
    const texts = [{ text: '別の行', boxes: [{ x: 10, y: 20, w: 40, h: 17 }] }]
    expect(replaceJoinedControlText(texts, [])).toEqual(texts)
  })
})
