import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* 完全切り替え：管理画面 の page.tsx は捨て、V8 の一覧（src/v8/scenarios/list.tsx・page.tsx が描く本体）を見る。 */
const PAGE = readFileSync(new URL('../../v8/scenarios/list.tsx', import.meta.url), 'utf8')

/**
 * #981 A05-02: シナリオ総数とフォルダ内訳の母集団の照合。
 *
 * 「すべて」・数の帯・未分類・共通のシナリオの説明・アカウント切替の動きは
 * v8/scenarios/list-counts-and-actions.test.tsx が描いて守る。ここは絞り込み後の件数や
 * 今のページの行数で数える書き方へ戻さない禁止の見張りだけを残す。
 */
describe('シナリオ一覧の件数定義（#981 A05-02）', () => {
  it('「すべて」と見出し総数は、絞り込み無しの全体件数を別口で数える', () => {
    expect(PAGE).not.toContain("label: 'すべて', count: scenarioList.total")
    expect(PAGE).not.toContain('allCount={scenarioList.total}')
  })

  it('「未分類」の件数はAPIの unfiledCount で、現在ページの行数では数えない', () => {
    expect(PAGE).not.toMatch(/scenarios\.filter\(\(sc\) => !sc\.folderId\)\.length/)
  })

  it('KPIのシナリオ総数は「すべて」と同じ口（overallTotal）で数える', () => {
    expect(PAGE).not.toContain('value: s.scenarios.total')
  })
})
