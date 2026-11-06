import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * 配信結果の読み込み・失敗・ページ送り・古い応答の扱いは v8/scenarios/results-loading-and-plan.test.tsx、
 * 状態の札と取れない数の「—」は create-results.test.tsx が描いて守る。
 * ここは固定の件数・見本の率・0 への置き換えへ戻さない禁止の見張りだけを残す。
 */
const PAGE = readFileSync(new URL('../../../v8/scenarios/results.tsx', import.meta.url), 'utf8')

describe("管理画面 5-1-L シナリオ配信結果", () => {
  it('SCENARIO-13: 配信記録を待たずにシナリオ・集計を先に表示する', () => {
    expect(PAGE).not.toContain('api.scenarios.runs(id, selectedAccountId, { limit: 50 })')
  })

  it('取れない開封・クリック・失敗数を0として作らない', () => {
    expect(PAGE).not.toContain('result?.reachedCount ?? 0')
    expect(PAGE).not.toContain('82.4%')
    expect(PAGE).not.toContain('46.1%')
  })
})
