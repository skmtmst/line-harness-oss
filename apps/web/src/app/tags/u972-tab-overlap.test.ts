import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #972 U029: 390pxではタブ行と右端の「CSVで一括登録」が重なっていた。
 * 共通タブ（components/shared/tabs）はこの案件の所有外なので、画面側に
 * 「収まらないとき折り返す」印と上書きを置く。印と上書きの両方が
 * そろっていないと、片方だけ残った静かな退行になる。
 */
describe('U029 友だち属性のタブとCSVの重なり', () => {
  it('タブ行を包む印があり、収まらない幅で折り返す上書きがある', () => {
    expect(PAGE).toContain('data-tabs-row')
    expect(PAGE).toContain('[data-tabs-row] nav:has(> span)')
    expect(PAGE).toContain('flex-wrap: wrap')
    expect(PAGE).toContain('height: auto')
  })

  it('共通タブではなく画面側の印へ結び付けている', () => {
    // 共通部品の className ではなく data 印を足す形。shared/tabs の
    // 中身（height:44px固定）は触っていない前提をここで示す。
    expect(PAGE).toContain('TagsPageV4')
    expect(PAGE).not.toContain('components/shared/tabs.module.css')
  })
})
