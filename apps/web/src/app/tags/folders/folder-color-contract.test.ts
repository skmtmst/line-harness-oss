import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'new', 'page.tsx'), 'utf8')

/**
 * 属性フォルダの色（設計 `byqIW` 4-1-G、要件 04 §13）。
 *
 * 要件は「**色だけでフォルダ・マーク・状態を区別しない**」
 * 「**すべての色選択に名前またはラベルを付ける**」と決めている。
 */
describe('フォルダの色', () => {
  it('16進数ではなく名前で読み上げる', () => {
    /*
      前は `aria-label={`色 ${item}`}` で、読み上げが「色 #3B82F6」だった。
      **色が見えない人には16進数しか届かない。**
    */
    expect(PAGE).toContain('aria-label={item.name}')
    expect(PAGE).not.toContain('aria-label={`色 ${item}`}')
    for (const name of ['緑', '青', '水色', '紫', 'ピンク', '赤', '黄', 'グレー']) {
      expect(PAGE).toContain(`name: '${name}'`)
    }
  })

  it('緑から始める', () => {
    /*
      V6 の基調色は `--color-accent`（#06c755）。設計 `byqIW` も緑始まり。
      青から始めると、**既定で選ばれる色が基調色から外れる。**
    */
    const list = PAGE.slice(PAGE.indexOf('const COLORS'), PAGE.indexOf(']', PAGE.indexOf('const COLORS')))
    expect(list.indexOf("'#06C755'")).toBeGreaterThan(-1)
    expect(list.indexOf("'#06C755'")).toBeLessThan(list.indexOf("'#3B82F6'"))
  })

  it('選んでいることを色だけで示さない', () => {
    // 枠と✓の両方で示す。色の丸だけだと、選択中が色の違いにしか出ない。
    expect(PAGE).toContain('aria-pressed={selected}')
    expect(PAGE).toContain('ring-accent ring-2')
    expect(PAGE).toContain('<Check size={16}')
  })
})
