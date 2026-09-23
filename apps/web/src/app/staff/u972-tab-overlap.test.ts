import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #972 U031: 390pxではタブの並びが右端の「人を追加する」に重なっていた。
 * 主タブ（MergedTabs）は横スクロール＋共通の狭幅対応へ任せ、
 * 横スクロールを持たない役わり絞り込み（Tabs）だけ画面側で折り返す。
 * 主タブに折り返しを付けるとスクロールと衝突して語の途中で割れる。
 */
describe('U031 スタッフのタブと追加操作の重なり', () => {
  it('折り返しの印は役わり絞り込み行だけに残す', () => {
    // data-tabs-row のJSX属性は役わり絞り込みの Tabs 行にだけ付く
    // （styleブロック内のセレクタ [data-tabs-row] は数えないよう > で区別）。
    expect(PAGE.match(/data-tabs-row>/g)).toHaveLength(1)
    expect(PAGE).toContain('data-tabs-row><Tabs')
    expect(PAGE).toContain('[data-tabs-row] nav:has(> span)')
    expect(PAGE).toContain('flex-wrap: wrap')
    expect(PAGE).toContain('height: auto')
    expect(PAGE).toContain('margin-left: auto')
  })

  it('主タブは横スクロールに任せ、追加操作の構えも変えない', () => {
    expect(PAGE).toContain('<MergedTabs')
    expect(PAGE).not.toContain('data-tabs-row><MergedTabs')
    expect(PAGE).toContain('人を追加する')
    expect(PAGE).toContain('actions={tabAction}')
  })
})
