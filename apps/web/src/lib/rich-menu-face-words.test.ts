import { describe, expect, it } from 'vitest'

import { TEMPLATES } from './rich-menu-templates'

/**
 * リッチメニューの面の呼び方（設計 `XtfO3` 12-1-A）。
 *
 * **設計は押せるところを「面」と呼び、A〜F の記号で一貫している。**
 * 実装だけが「分割」と呼んでいたので、同じものを2つの言葉で説明していた。
 * 図の説明も「面の分けかた」にそろえる。
 */
describe('面の呼び方', () => {
  const labels = TEMPLATES.map((t) => t.label)

  it('「分割」と呼ばない', () => {
    const wrong = labels.filter((label) => label.includes('分割'))
    expect(wrong, `設計は「面」と呼ぶ: ${wrong.join(', ')}`).toEqual([])
  })

  it('設計にある形の名前をそのまま使う', () => {
    /* 設計 `XtfO3` の「面の分けかた」に並ぶ名前。 */
    for (const name of ['上下2面', '左右2面', '上1・下2', '上2・下1']) {
      expect(labels, `${name} が無い`).toContain(name)
    }
  })

  it('全体で1つの形も「面」で数える', () => {
    /* 「分割なし」だと、何面なのかが読めない。 */
    expect(labels).toContain('1面（全体で1つ）')
  })
})
