import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #981 A05-02: シナリオ総数とフォルダ内訳の母集団の照合。
 *
 * 一覧・「すべて」・KPI・フォルダ内訳・「未分類」が同じ画面に並ぶため、
 * 別々の母集団で数えると数字が食い違って見える（NEXT-26 の再発防止）。
 *
 * 残る唯一の定義差は「全アカウント共通（line_account_id IS NULL）の
 * シナリオ」。アカウントを1つ選んだ表示では一覧と「すべて」に出るが、
 * フォルダAPIの件数はそのアカウントの行だけを数える（#730、Worker側の
 * 仕様）。ずれではなく定義の違いとして、画面に説明を出す。
 */
describe('シナリオ一覧の件数定義（#981 A05-02）', () => {
  it('「すべて」と見出し総数は、絞り込み無しの全体件数を別口で数える', () => {
    expect(PAGE).toContain('const [overallTotal, setOverallTotal]')
    expect(PAGE).toContain("id: '', label: 'すべて', count: overallTotal")
    // 絞り込み後の scenarioList.total を「すべて」に使ってはいけない。
    expect(PAGE).not.toContain("label: 'すべて', count: scenarioList.total")
  })

  it('フォルダAPI・KPIは一覧と同じアカウント範囲で数える', () => {
    expect(PAGE).toContain("api.folders.list('scenario', accountId ?? undefined)")
    expect(PAGE).toContain('accountId={selectedAccountId ?? undefined}')
  })

  it('「未分類」の件数はAPIの unfiledCount で、現在ページの行数では数えない', () => {
    expect(PAGE).toContain('unfiledCount')
    expect(PAGE).not.toMatch(/scenarios\.filter\(\(sc\) => !sc\.folderId\)\.length/)
  })

  it('KPIのシナリオ総数は「すべて」と同じ口（overallTotal）で数える', () => {
    // list-stats の scenarios.total は共通適用（NULL）を含まない。
    expect(PAGE).toContain('value: overallTotal')
    expect(PAGE).not.toContain('value: s.scenarios.total')
  })

  it('全アカウント共通のシナリオが内訳に含まれないことを画面で説明する', () => {
    expect(PAGE).toContain('sharedScenarioCount')
    expect(PAGE).toContain('全アカウントに共通で適用されるシナリオが')
    expect(PAGE).toContain('フォルダ別の件数と「未分類」には含まれません')
  })

  it('アカウント切替でフォルダ帯・選択フォルダ・全体件数をリセットする', () => {
    expect(PAGE).toContain('activeAccountRef.current = selectedAccountId')
    expect(PAGE).toContain('setFolders([])')
    expect(PAGE).toContain('setUnfiledCount(null)')
    expect(PAGE).toContain("setFolderFilter('')")
    expect(PAGE).toContain('setOverallTotal(null)')
    // 遅い応答の採用拒否。
    expect(PAGE).toContain('if (activeAccountRef.current !== accountId) return')
  })
})
