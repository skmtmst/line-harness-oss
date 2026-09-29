import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #972 U034: 390px・768pxで見出しが右の操作に押されて1文字ずつ縦に
 * 割れていた。共通の PageHeader の形は変えず、この画面の見出し帯だけ
 * 「収まらないとき操作を次の行へ下げる」にする。
 */
describe('U034 機能設定の見出しの縦割れ', () => {
  it('見出し帯に折り返しの印と上書きがある', () => {
    expect(PAGE).toContain('data-page-header-wrap')
    expect(PAGE).toContain('[data-page-header-wrap] > div { flex-wrap: wrap; }')
    expect(PAGE).toContain('[data-page-header-wrap] > div > div + div')
    expect(PAGE).toContain('max-width: 100%')
  })

  it('見出し操作の顔ぶれは変えていない', () => {
    expect(PAGE).toContain('並びを変える')
    expect(PAGE).toContain('初期値に戻す')
    expect(PAGE).toContain('機能設定を保存')
  })

  it('区分見出しの「まとめて切替」は語の途中で折れない', () => {
    expect(PAGE).toContain('whitespace-nowrap')
  })
})
