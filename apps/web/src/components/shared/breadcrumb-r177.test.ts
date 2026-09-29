import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'breadcrumb.module.css'), 'utf8')
const tsx = readFileSync(join(here, 'breadcrumb.tsx'), 'utf8')
const fieldEdit = readFileSync(join(here, '..', '..', 'app', 'tags', 'fields', 'edit', 'page.tsx'), 'utf8')
const fieldNew = readFileSync(join(here, '..', '..', 'app', 'tags', 'fields', 'new', 'page.tsx'), 'utf8')
const searchEdit = readFileSync(join(here, '..', '..', 'app', 'tags', 'searches', 'edit', 'page.tsx'), 'utf8')

/*
 * R177: 長い項目名で戻るボタンが右へ押し出されていた。
 * happy-dom には配置計算が無いため、省略の構図（パンくずの省略・
 * 見出し行の縮み・ボタンの固定・全文確認）を源泉で固定する。
 * 実機の幅確認（390・320px）は撮影（司令塔）で行う。
 */
describe('R177 パンくずと戻るボタンのはみ出し', () => {
  it('いま開いている場所は省略し、親の階層は縮めない', () => {
    expect(css).toContain('text-overflow: ellipsis;')
    expect(css).toContain('white-space: nowrap;')
  })

  it('省略した名称を全文確認できる', () => {
    expect(tsx).toContain('title={item.label}')
  })

  it('編集3画面の見出し行はパンくずを縮めボタンを残す', () => {
    /*
     * m22c: fields系の戻りはボタン枠から共通の行き先リンクへ変えた。
     * 残すのは「戻り先」であって枠ではない。パンくずが縮み（min-w-0）、
     * 戻り先が縮まず（shrink-0）残ることを見る。
     */
    for (const [name, page, back] of [
      ['fields/edit', fieldEdit, '>友だち情報欄へ</Link>'],
      ['fields/new', fieldNew, '>友だち情報欄へ</Link>'],
      ['searches/edit', searchEdit, '>保存した検索へ</Button>'],
    ] as const) {
      expect(page, `${name} のパンくずが縮まない`).toContain('<div className="min-w-0 flex-1">')
      expect(page, `${name} の戻り先が縮んで押せない`).toContain('shrink-0')
      expect(page, `${name} の戻り先が無い`).toContain(back)
    }
  })
})
