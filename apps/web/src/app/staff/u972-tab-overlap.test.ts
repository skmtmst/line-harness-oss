import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #972 U031: 390pxではタブの並びが右端の「人を追加する」に重なっていた。
 * 共通タブの形は変えず、この画面のタブ行だけ折り返す。
 */
describe('U031 スタッフのタブと追加操作の重なり', () => {
  it('タブ行に折り返しの印と上書きがある', () => {
    expect(PAGE).toContain('data-tabs-row')
    expect(PAGE).toContain('[data-tabs-row] nav:has(> span)')
    expect(PAGE).toContain('flex-wrap: wrap')
    expect(PAGE).toContain('height: auto')
    expect(PAGE).toContain('margin-left: auto')
  })

  it('タブと追加操作の構え自体は変えていない', () => {
    expect(PAGE).toContain('<MergedTabs')
    expect(PAGE).toContain('人を追加する')
    expect(PAGE).toContain('actions={tabAction}')
  })
})
