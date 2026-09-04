import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PART = readFileSync(join(HERE, 'broadcast-asset-manager.tsx'), 'utf8')

/**
 * カルーセルの呼び方と上限（設計 `FRkls` 11-1-B ／ 要件 11 §156・§160）。
 *
 * **設計も要件も「パネル」と呼び、上限を 10 と決めている。**
 * 実装だけが「カード」で 9 枚止まりだった——同じものを2つの言葉で説明し、
 * しかも 10 枚目を作れないのに理由も出ない状態だった。
 */
describe('カルーセルの呼び方', () => {
  it('「カード」と呼ばない', () => {
    /* 設計・要件の言葉に寄せる。実装だけ違う言葉を使わない。 */
    expect(PART).toContain('パネル {index + 1}')
    expect(PART).toContain('＋ パネルを追加（{cards.length}/{MAX_PANELS}）')
    expect(PART).toContain('末尾に「もっと見る」パネルを表示')
    expect(PART, '「カード」が画面に残っている').not.toMatch(/>カード\s|カードを追加|カードを表示/)
  })

  it('種類の名前も設計どおり「カルーセル」にする', () => {
    /* 設計 `FRkls` は「カルーセルを作る」。「カードタイプ」「カードセット」は実装だけの言葉。 */
    expect(PART).toContain("card_message: { title: 'カルーセル'")
    expect(PART).toContain("singular: 'カルーセル' }")
    expect(PART, '説明文が9枚のまま').toContain('最大10枚')
  })
})

describe('パネルの上限', () => {
  it('要件どおり 10 枚まで作れる', () => {
    /* 要件 11 §156「最大10パネル」。9 で止めると 10 枚目が作れない。 */
    expect(PART).toContain('const MAX_PANELS = 10')
    expect(PART).toContain('disabled={cards.length >= MAX_PANELS}')
  })

  it('上限を直書きしない', () => {
    /* 数が2か所に散ると、片方だけ直して数え方がずれる。 */
    expect(PART, '9 が残っている').not.toContain('cards.length >= 9')
    expect(PART).not.toContain('{cards.length}/9')
  })
})
