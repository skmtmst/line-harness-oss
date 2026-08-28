import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { savedSearchKpiValues } from './saved-search-kpis'

const LIST = fs.readFileSync(path.join(__dirname, 'saved-search-list.tsx'), 'utf8')

describe('保存した検索の上部指標', () => {
  it('取得できた実値だけをタグ単位で数える', () => {
    expect(savedSearchKpiValues([
      { matchCount: 0, usedIn: [{ kind: 'broadcast', id: 'b-1', name: '配信1', mode: 'live' }] },
      { matchCount: 12, usedIn: [{ kind: 'broadcast', id: 'b-2', name: '配信2', mode: 'fixed' }, { kind: 'scenario', id: 's-1', name: 'シナリオ1', mode: 'live' }] },
      { matchCount: 0, usedIn: [] },
    ], true)).toEqual({
      total: 3,
      usedInBroadcasts: 2,
      zeroMatches: 2,
      callsThisMonth: null,
    })
  })

  it('一覧の失敗を0件にしない', () => {
    expect(savedSearchKpiValues([], false)).toEqual({
      total: null,
      usedInBroadcasts: null,
      zeroMatches: null,
      callsThisMonth: null,
    })
  })

  it('使用先か該当人数が1件でも未取得なら少ない合計を出さない', () => {
    expect(savedSearchKpiValues([
      { matchCount: 0, usedIn: [] },
      { matchCount: null, usedIn: undefined },
    ], true)).toEqual({
      total: 2,
      usedInBroadcasts: null,
      zeroMatches: null,
      callsThisMonth: null,
    })
  })

  it('V6の4指標を共通カードで出し、未接続の84回を固定値にしない', () => {
    expect(LIST).toContain('data-design-node="QKx8Q"')
    expect(LIST).toContain('title="保存した条件"')
    expect(LIST).toContain('title="配信で使用中"')
    expect(LIST).toContain('title="該当者0人"')
    expect(LIST).toContain('title="今月の呼び出し"')
    expect(LIST).toContain('detail="呼び出し記録は未接続"')
    expect(LIST).toContain('api.friendFields.list()')
    expect(LIST).not.toContain('value={84}')
  })
})
