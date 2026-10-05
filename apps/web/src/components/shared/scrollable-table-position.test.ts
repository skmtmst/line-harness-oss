import { describe, expect, it } from 'vitest'
import { scrollToThumb, thumbToScroll } from './scrollable-table-position'

describe('横送り表のつまみと実際の送り量', () => {
  it('絵の送り量とつまみ位置を同時に保ち、先頭と末尾へ届く', () => {
    expect(scrollToThumb(250, 958, 336)).toBeCloseTo(120)
    expect(thumbToScroll(120, 958, 336)).toBeCloseTo(250)
    expect(scrollToThumb(0, 958, 336)).toBe(0)
    expect(scrollToThumb(958, 958, 336)).toBe(336)
    expect(thumbToScroll(0, 958, 336)).toBe(0)
    expect(thumbToScroll(336, 958, 336)).toBe(958)
  })

  it.each([[958, 336], [1200, 200], [80, 20]])('幅が変わっても逆向きのドラッグで元の位置へ戻る (%s/%s)', (maximum, travel) => {
    let previousLeft = -1
    for (let i = 0; i <= 100; i++) {
      const scroll = maximum * i / 100
      const left = scrollToThumb(scroll, maximum, travel)
      expect(left).toBeGreaterThan(previousLeft)
      expect(thumbToScroll(left, maximum, travel)).toBeCloseTo(scroll)
      previousLeft = left
    }
  })

  it('横送り不要の幅や範囲外のドラッグで無効な位置を返さない', () => {
    expect(scrollToThumb(250, 0, 0)).toBe(0)
    expect(thumbToScroll(120, 958, 0)).toBe(0)
    expect(thumbToScroll(-100, 958, 336)).toBe(0)
    expect(thumbToScroll(1000, 958, 336)).toBe(958)
  })
})
