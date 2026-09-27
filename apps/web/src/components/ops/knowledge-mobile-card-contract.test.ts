import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(ROOT, 'knowledge-list.tsx'), 'utf8')
const CSS = readFileSync(join(ROOT, 'knowledge.module.css'), 'utf8')

/*
 * 監査 R134: 運営ナレッジ一覧を 390px で開くと、8列の表が1列44pxに潰れて
 * 題名も操作名も切れていた。狭い画面では1記事1枚のカードに畳み、
 * 題名を先頭に・項目をラベル付きで・操作を十分な幅で出す。
 */
describe('運営ナレッジ一覧の狭い画面 (監査R134)', () => {
  it('表の各項目にカード表示用のラベルが付いている', () => {
    for (const label of ['種類', '記事の種類', '状態', '使われた回数', '役に立った', '更新日']) {
      expect(LIST, `data-label="${label}" が無い`).toContain(`data-label="${label}"`)
    }
  })

  it('狭い画面では表を畳んでカードにし、ラベルは data-label から出す', () => {
    expect(CSS).toContain('@media (max-width: 640px)')
    expect(CSS).toContain('.table thead { display: none; }')
    expect(CSS).toContain('content: attr(data-label)')
    // 操作ボタンがセルの外へ切れないよう、はみ出しを隠さない。
    expect(CSS).toContain('overflow: visible')
    // 題名は1行省略せず読める形にする。
    expect(CSS).toContain('overflow-wrap: anywhere')
  })
})
