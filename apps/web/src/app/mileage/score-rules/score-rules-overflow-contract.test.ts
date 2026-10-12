import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * #973 U046: スコアのルール（/mileage/score-rules）の保存エリアが
 * 4列固定で、状態文が潰れて押し口と衝突していた。
 */
describe('スコアのルールの保存エリア（#973 U046）', () => {
  it('4列固定の保存エリアを持たない', () => {
    expect(PAGE).not.toContain('min-h-16 grid-cols-4')
    const stickyBar = PAGE.match(/footerActions=\{[\s\S]{0,1000}?スコアのルールを公開/)
    expect(stickyBar, '保存エリアが見つからない').not.toBeNull()
    expect(stickyBar![0]).not.toContain('grid-cols-4')
  })

  it('状態文と押し口はV8の型へ別々に渡す', () => {
    expect(PAGE).toContain('<CreatePage')
    expect(PAGE).toContain('status={bundle && configuration ?')
    expect(PAGE).toContain('公開後に起きたことから新しい点数が付きます')
    expect(PAGE).toContain('footerActions={bundle && configuration && canEdit ?')
    expect(PAGE).not.toContain('sticky bottom-0')
  })
})
