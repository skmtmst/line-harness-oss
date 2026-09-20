import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(new URL('./column.module.css', import.meta.url), 'utf8')
const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U059: 390pxで「届く形」が入力3枚のあとに来て、
 * 保存へ届く前に全部をスクロールさせられていた。
 * 狭い幅ではプレビューだけ題名の直後へ上げる。
 */
describe('NENコラム作成のプレビュー位置（#975 U059）', () => {
  it('狭い幅ではプレビューが題名の直後に来る', () => {
    expect(CSS).toContain('.main, .side { display: contents; }')
    expect(CSS).toContain('[data-nen-part="preview"] { order: 2; }')
    expect(CSS).toContain('[data-nen-part="title"] { order: 1; }')
    expect(CSS).toContain('[data-nen-part="article"] { order: 3; }')
  })

  it('並べ替えに使う印がページ側にある', () => {
    for (const part of ['title', 'preview', 'article', 'publish', 'tips', 'links', 'cannot']) {
      expect(PAGE).toContain(`data-nen-part="${part}"`)
    }
  })

  it('保存は下部追従バーに置いたまま', () => {
    expect(PAGE).toContain('<StickyBar')
    expect(PAGE).toContain('下書きに保存')
  })
})
