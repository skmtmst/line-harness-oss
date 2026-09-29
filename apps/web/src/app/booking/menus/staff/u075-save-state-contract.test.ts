import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U075: 変えていない・変えたが未保存・保存済み・失敗を区別し、
 * 差分がないときは保存を押せない。
 */
describe('担当割り当ての保存状態（#975 U075）', () => {
  it('最後に保存・読み込みした表を控えて差分を見る', () => {
    expect(PAGE).toContain('savedGrid')
    expect(PAGE).toContain("JSON.stringify(grid) !== JSON.stringify(savedGrid)")
  })

  it('差分がないときは保存の押し口を出さず中立の札にする', () => {
    expect(PAGE).toContain('|| !dirty')
    expect(PAGE).toContain('変更なし')
    expect(PAGE).toContain('tone="neutral"')
  })

  it('状態を文字で出す（未保存・変更なし・失敗）', () => {
    expect(PAGE).toContain('未保存の変更があります')
    expect(PAGE).toContain('変更はありません')
    expect(PAGE).toContain('保存できませんでした')
  })
})
