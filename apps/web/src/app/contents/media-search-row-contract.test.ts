import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * U016 → ★V7 `Xn1Mz`（2026-09-27 オーナー指摘）。
 *
 * U016（外部UI監査 ab9d80b07）の旧処方は「検索を独立した全幅の行に」
 * だったが、正本を「検索は幅320で1行目、2行目は左に絞り込み・右端に
 * 表示切替・並び順・表示件数」に変えた。潰れ対策の意図は残す：検索は
 * 320（狭い時は240まで）で折り返し、読めないほど潰さない。幅の実数は
 * 共通 ListToolbar の契約テストで守る。
 */
describe('登録メディアの検索行（U016 → ★V7 Xn1Mz）', () => {
  it('検索は共通 ListToolbar の1行目に置く', () => {
    expect(PAGE).toContain("import ListToolbar from '@/components/shared/list-toolbar'")
    expect(PAGE).toContain('<ListToolbar')
    expect(PAGE).toContain("placeholder: 'ファイル名で検索'")
  })

  it('検索を横いっぱいに伸ばさない（裸の全幅 input を置かない）', () => {
    expect(PAGE).not.toContain('data-search-row')
    expect(PAGE).not.toContain('type="search"')
    expect(PAGE).not.toMatch(/<SearchField[\s\S]*?className="w-full"/)
  })

  it('種別フィルタは2行目の左（filters）に置く', () => {
    const toolbarAt = PAGE.indexOf('<ListToolbar')
    const filtersAt = PAGE.indexOf('filters={', toolbarAt)
    expect(filtersAt).toBeGreaterThan(toolbarAt)
    expect(PAGE.indexOf('使っていない', filtersAt)).toBeGreaterThan(filtersAt)
  })

  it('表示切替・並び順・表示件数は2行目の右（trailing）に置く', () => {
    const toolbarAt = PAGE.indexOf('<ListToolbar')
    const trailingAt = PAGE.indexOf('trailing={', toolbarAt)
    expect(trailingAt).toBeGreaterThan(toolbarAt)
    for (const name of ['aria-label="並べ方"', 'aria-label="並び順"', 'aria-label="表示件数"'] as const) {
      expect(PAGE.indexOf(name, trailingAt), `${name} が2行目の右に無い`).toBeGreaterThan(trailingAt)
    }
    // 結果の一覧（`h8pBZr`）より前にある。
    expect(trailingAt).toBeLessThan(PAGE.indexOf('data-design-node="h8pBZr"'))
  })

  it('削除はメニューの中の危ない操作にし、ゴミ箱の直置きを残さない', () => {
    expect(PAGE).toContain("label: '削除する', tone: 'danger'")
    expect(PAGE).not.toContain('aria-label={`${item.filename}を削除`}')
  })
})
