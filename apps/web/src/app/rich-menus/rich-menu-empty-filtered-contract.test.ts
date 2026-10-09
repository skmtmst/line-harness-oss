import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(new URL('../../v8/rich-menus/list.tsx', import.meta.url), 'utf8')

/**
 * R173: 絞り込み0件をデータ未作成の状態として案内しない。
 *
 * 下書きだけがある状態で「公開中」を押すと0件になる。「まだリッチ
 * メニューがありません」と作る口を出すと、保存済みが消えたように
 * 見える。絞りが効いているときの0件は共通 ListState の `filtered`
 * （「条件に合うものがありません」）と「onClearFilters={clearFilters}」ボタンにする。
 */
describe('R173 リッチメニューの0件の出し分け', () => {
  it('絞りが効いているときの0件は filtered と条件クリアにする', () => {
    expect(PAGE).toContain('filterActive')
    expect(PAGE).toContain('filtered={filterActive}')
    expect(PAGE).toContain('onClearFilters={clearFilters}')
    expect(PAGE).toContain('clearFilters')
  })

  it('条件クリアは検索・絞り込み・フォルダをまとめて戻す', () => {
expect(PAGE).toContain("setView({ q: '', view: '', folder: '', page: '1' })")
  })

  it('何も絞っていない0件は従来どおり「まだリッチメニューがありません」', () => {
    expect(PAGE).toContain('title="まだリッチメニューがありません"')
  })
})
