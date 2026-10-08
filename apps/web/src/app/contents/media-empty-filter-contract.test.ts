import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * R38: 絞り込みの結果が0件なのに「まだメディアがありません」と出る。
 * 「すべて」の選び方（上限に近い が抜けていた）・0件の言い分け・
 * フォルダの総数と絞り込みの件数の混在を直す。
 */

const MEDIA = readFileSync(new URL("./../../v8/contents/list.tsx", import.meta.url), 'utf8')
const VARS = readFileSync(new URL("./../../v8/common-vars/list.tsx", import.meta.url), 'utf8')

describe('R38 絞り込みと0件表示の言い分け', () => {
  it('「すべて」は上限に近い を含むすべての絞り込みが外れているときだけ選ぶ', () => {
expect(MEDIA).toContain("showNearLimitOnly ? 'near-limit'")
    expect(MEDIA).toContain("else if (value === 'near-limit') applyNearLimitFilter()")
  })

  it('0件の言い分けは絞り込み後の件数と絞り込みの有無の両方を見る', () => {
expect(MEDIA).toContain('current.length === 0')
    expect(MEDIA).toContain('filtered={hasFilter}')
    expect(MEDIA).toContain('kinds.size !== KINDS.length')
  })

  it('絞り込みの0件には作る口を出さず「条件を外す」を置く', () => {
expect(MEDIA).toContain('filtered={hasFilter}')
    expect(MEDIA).toContain('onClearFilters={clearFilters}')
    expect(MEDIA).toContain('<EmptyList')
  })

  it('フォルダ欄の「すべて」は絞り込み前の総数を出す', () => {
    // m26m: 未取得の間は偽ゼロにせず伏せるが、総数の出どころは絞り込み前の
    // overallTotal のまま（R38の約束は変えない）。
    expect(MEDIA).toContain('count: listKnown && !loadFailed ? (overallTotal ?? total) : null')
    expect(MEDIA).toContain('limit: 1,')
  })

  it('共通情報一覧の絞り込み0件にも「条件を外す」を置く', () => {
expect(VARS).toContain('filtered={items.length > 0}')
    expect(VARS).toContain('onClearFilters={clearVarFilters}')
    expect(VARS).toContain("setChip('all')")
  })
})
