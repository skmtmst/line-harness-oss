import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(ROOT, '../../v8/ops/knowledge.tsx'), 'utf8')
const CSS = readFileSync(join(ROOT, '../../v8/ops/parts.module.css'), 'utf8')

/*
 * 監査 R134: 運営ナレッジ一覧を 390px で開くと、8列の表が1列44pxに潰れて
 * 題名も操作名も切れていた。狭い画面では1記事1枚のカードに畳み、
 * 題名を先頭に・項目をラベル付きで・操作を十分な幅で出す。
 */
describe('運営ナレッジ一覧の項目と省略表示', () => {
  it('表の各項目は現在の列の見出しで区別できる', () => {
    for (const label of ['種類', '状態', '使われた回数', '役に立った', '更新日']) {
      expect(LIST).toContain(`role="columnheader">${label}`)
    }
  })

  it('名前の列は伸び縮みし、省略した全文は同じ場所で読める', () => {
    expect(LIST).toContain('className={parts.grow} role="cell" title={article.title}')
    expect(CSS).toMatch(/\.grow\s*\{[^}]*min-width:\s*0/s)
    expect(CSS).toMatch(/\.grow\s*\{[^}]*flex:\s*1/s)
    expect(CSS).toMatch(/\.grow\s*\{[^}]*text-overflow:\s*ellipsis/s)
  })
})
