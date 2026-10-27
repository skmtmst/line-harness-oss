import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PART = readFileSync(join(HERE, 'broadcast-asset-manager.tsx'), 'utf8')

/**
 * カルーセルの呼び方と上限（設計 `FRkls` 11-1-B ／ 要件 11 §156・§160）の禁止の見張り。
 *
 * 「パネル」と呼ぶこと・10 枚まで作れること・「もっと見る」で 9 枚になることは、
 * broadcast-asset-manager-carousel.test.tsx が画面を押して見る。
 */
describe('カルーセルの呼び方', () => {
  it('「カード」と呼ばない', () => {
    expect(PART, '「カード」が画面に残っている').not.toMatch(/>カード\s|カードを追加|カードを表示/)
  })
})

describe('パネルの上限', () => {
  it('上限を直書きしない', () => {
    /* 数が2か所に散ると、片方だけ直して数え方がずれる。 */
    expect(PART, '9 が残っている').not.toContain('cards.length >= 9')
    expect(PART).not.toContain('{cards.length}/9')
  })
})
