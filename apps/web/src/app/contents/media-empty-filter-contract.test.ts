import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * R38: 絞り込みの結果が0件なのに「まだメディアがありません」と出る。
 * 「すべて」の選び方（上限に近い が抜けていた）・0件の言い分け・
 * フォルダの総数と絞り込みの件数の混在を直す。
 */

const MEDIA = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const VARS = readFileSync(new URL('./vars/page.tsx', import.meta.url), 'utf8')
const EMPTY = readFileSync(new URL('../../components/shared/empty-list.tsx', import.meta.url), 'utf8')

describe('R38 絞り込みと0件表示の言い分け', () => {
  it('「すべて」は上限に近い を含むすべての絞り込みが外れているときだけ選ぶ', () => {
    const filters = MEDIA.slice(MEDIA.indexOf('const hasFilter ='), MEDIA.indexOf('const clearFilters ='))
    for (const condition of ["query.trim() !== ''", "folderFilter !== ''", 'kinds.size !== KINDS.length', '|| showUnusedOnly', '|| showNearLimitOnly', '|| showArchivedOnly']) expect(filters).toContain(condition)
  })

  it('0件の言い分けは絞り込み後の件数と絞り込みの有無の両方を見る', () => {
    expect(MEDIA).toContain('current.length === 0')
    expect(MEDIA).toContain('filtered={hasFilter}')
    expect(MEDIA).toContain('kinds.size !== KINDS.length')
  })

  it('絞り込みの0件には作る口を出さず「条件を外す」を置く', () => {
    expect(MEDIA).toContain('onClearFilters={clearFilters}')
    expect(EMPTY).toContain('if (filtered)')
    expect(EMPTY).toContain('条件に合うものがありません')
    expect(EMPTY).toContain('onClick={onClearFilters}>条件を外す')
    expect(EMPTY.indexOf('if (filtered)')).toBeLessThan(EMPTY.indexOf('const button ='))
  })


  it('共通情報一覧の絞り込み0件にも「条件を外す」を置く', () => {
    expect(VARS).toContain('filtered={items.length > 0}')
    expect(VARS).toContain('onClearFilters={clearVarFilters}')
    expect(EMPTY).toContain('条件に合うものがありません')
    expect(VARS).toContain("setChip('all')")
  })
})
