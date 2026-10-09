import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * R38: 絞り込みの結果が0件なのに「まだメディアがありません」と出る。
 * 「すべて」の選び方（上限に近い が抜けていた）・0件の言い分け・
 * フォルダの総数と絞り込みの件数の混在を直す。
 */

const MEDIA = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const VARS = readFileSync(new URL('./vars/page.tsx', import.meta.url), 'utf8')

describe('R38 絞り込みと0件表示の言い分け', () => {
  it('「すべて」は上限に近い を含むすべての絞り込みが外れているときだけ選ぶ', () => {
    expect(MEDIA).toContain(
      'selected={kinds.size === KINDS.length && !showUnusedOnly && !showNearLimitOnly && !showArchivedOnly}',
    )
  })

  it('0件の言い分けは絞り込み後の件数と絞り込みの有無の両方を見る', () => {
    expect(MEDIA).toContain('total === 0 && !hasFilter')
    expect(MEDIA).toContain('kinds.size !== KINDS.length')
  })

  it('絞り込みの0件には作る口を出さず「条件を外す」を置く', () => {
    expect(MEDIA).toContain('emptyPreset="filtered"')
    expect(MEDIA).toContain('条件に合うメディアはありません')
    expect(MEDIA).toContain('条件を外す')
    expect(MEDIA).toContain('onClick={clearFilters}')
  })

  it('フォルダ欄の「すべて」は絞り込み前の総数を出す', () => {
    // m26m: 未取得の間は偽ゼロにせず伏せるが、総数の出どころは絞り込み前の
    // overallTotal のまま（R38の約束は変えない）。
    expect(MEDIA).toContain('count: listKnown && !loadFailed ? (overallTotal ?? total) : null')
    expect(MEDIA).toContain('limit: 1,')
  })

  it('共通情報一覧の絞り込み0件にも「条件を外す」を置く', () => {
    expect(VARS).toContain('emptyPreset={items.length === 0 ? \'createable\' : \'filtered\'}')
    expect(VARS).toContain('条件に合う共通情報はありません')
    expect(VARS).toContain('onClick={clearVarFilters}')
    expect(VARS).toContain("setStateFilter('all')")
  })
})
