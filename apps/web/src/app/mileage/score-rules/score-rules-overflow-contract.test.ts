import { readFileSync } from 'node:fs'
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
    const stickyBar = PAGE.match(/sticky bottom-0[^"]*"[\s\S]{0,800}?スコアのルールを公開/)
    expect(stickyBar, '保存エリアが見つからない').not.toBeNull()
    expect(stickyBar![0]).not.toContain('grid-cols-4')
  })

  it('状態文は全幅で上、押し口は折り返せる行で下に置く', () => {
    const stickyBar = PAGE.match(/sticky bottom-0[^"]*"[\s\S]{0,800}?スコアのルールを公開/)
    // 状態文→押し口の順。同じ行に押し込まない。
    const statusIndex = stickyBar![0].indexOf('公開後に起きたことから新しい点数が付きます')
    const buttonsIndex = stickyBar![0].indexOf('flex flex-wrap items-center justify-end')
    expect(statusIndex).toBeGreaterThan(-1)
    expect(buttonsIndex).toBeGreaterThan(statusIndex)
  })
})
