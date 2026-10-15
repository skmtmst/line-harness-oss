import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

// 現役V8の共通道具欄で検索・絞り込み・並べ替えの接続を守る。
describe('V8 登録メディアの検索と操作', () => {
  it('検索は共通 ListToolbar の1行目に置く', () => {
    expect(PAGE).toContain("import ListToolbar from '@/components/shared/list-toolbar'")
    expect(PAGE).toContain('<ListToolbar')
    expect(PAGE).toContain("placeholder: 'ファイル名で探す'")
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
    for (const name of ['aria-label="並べ方"', 'aria-label="よく使う絞り込み"', 'aria-label="表示件数"'] as const) {
      expect(PAGE.indexOf(name, trailingAt), `${name} が2行目の右に無い`).toBeGreaterThan(trailingAt)
    }
    expect(PAGE).toContain('...SORT_OPTIONS.map')
    expect(PAGE).toContain('setSort(value.slice(5) as MediaSort)')
  })

  it('削除はメニューの中の危ない操作にし、ゴミ箱の直置きを残さない', () => {
    expect(PAGE).toContain("label: '削除する', tone: 'danger'")
    expect(PAGE).not.toContain('aria-label={`${item.filename}を削除`}')
  })
})
