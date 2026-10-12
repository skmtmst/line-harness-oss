import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { savedSearchKpiValues } from './saved-search-kpis'

const LIST = fs.readFileSync(path.join(__dirname, '../../v8/tags/searches-tab.tsx'), 'utf8')

describe('保存した検索の上部指標', () => {
  it('取得できた実値だけをタグ単位で数える', () => {
    expect(savedSearchKpiValues([
      { matchCount: 0, usedIn: [{ kind: 'broadcast', id: 'b-1', name: '配信1', mode: 'live' }], callCountThisMonth: 31 },
      { matchCount: 12, usedIn: [{ kind: 'broadcast', id: 'b-2', name: '配信2', mode: 'fixed' }, { kind: 'scenario', id: 's-1', name: 'シナリオ1', mode: 'live' }], callCountThisMonth: 18 },
      { matchCount: 0, usedIn: [], callCountThisMonth: 9 },
    ], true)).toEqual({
      total: 3,
      usedInBroadcasts: 2,
      zeroMatches: 2,
      callsThisMonth: 58,
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
      { matchCount: 0, usedIn: [], callCountThisMonth: 1 },
      { matchCount: null, usedIn: undefined, callCountThisMonth: undefined },
    ], true)).toEqual({
      total: 2,
      usedInBroadcasts: null,
      zeroMatches: null,
      callsThisMonth: null,
    })
  })

  it('V8の4指標を共通カードで出し、呼び出し回数はAPIの実値だけを合計する', () => {
    expect(LIST).toContain('<KpiBand')
    expect(LIST).toContain("title: '保存した条件'")
    expect(LIST).toContain("title: '配信で使っている'")
    expect(LIST).toContain("title: '該当なし'")
    expect(LIST).toContain("title: '今月の利用'")
    expect(LIST).toContain('kpis.callsThisMonth')
    expect(LIST).toContain('api.friendFields.list(accountId, undefined, { suppressFeatureDisabledEvent: true })')
    expect(LIST).not.toContain('value={84}')
  })
})
