import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../../v8/scenarios/results.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('../detail/scenario-detail-client.tsx', import.meta.url), 'utf8')

describe('V6 5-1-L シナリオ配信結果', () => {
  it('実Node IDとシナリオ・統計・開始記録APIを使う', () => {
    expect(PAGE).toContain('boardId="X4STXS"')
    expect(PAGE).toContain('scenarioReferenceData.scenario(id)')
    expect(PAGE).toContain('scenarioReferenceData.stats(id)')
    expect(PAGE).toContain('api.scenarios.runs(id, selectedAccountId, {')
    expect(PAGE).toContain('limit: RUNS_PAGE_SIZE')
    expect(DETAIL).toContain('href={`/scenarios/results?id=${id}`}')
  })

  it('読込・失敗・配信内容なしを分ける', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('onRetry={() => void loadMain(loadSeqRef.current)}')
  })

  it('SCENARIO-10: 配信記録の取得失敗を「購読者なし」と表示しない', () => {
    /*
     * runs の読み込み状態を独立させ、失敗は再試行つきの error、
     * 正常に0件のときだけ empty を出す。アカウント未選択は idle として
     * 案内し、「まだいません」とは書かない。
     */
    expect(PAGE).toContain("useState<'idle' | 'loading' | 'ready' | 'error'>")
    expect(PAGE).toContain('onRetry={() => void loadRuns(loadSeqRef.current)}')
    expect(PAGE).toContain("runsState === 'idle'")
  })

  it('SCENARIO-11: 画面・アカウント切替後の古い応答を世代番号で捨てる', () => {
    expect(PAGE).toContain('loadSeqRef')
    expect(PAGE).toContain('const seq = ++loadSeqRef.current')
    expect(PAGE).toContain('seq !== loadSeqRef.current')
  })

  it('SCENARIO-12: カーソルページングと総件数・状態絞り込みを接続する', () => {
    expect(PAGE).toContain('runs.pagination.nextCursor')
    expect(PAGE).toContain('runs.pagination.total')
    expect(PAGE).toContain('status: subscriptionStatus || undefined')
  })

  it('SCENARIO-13: 配信記録を待たずにシナリオ・集計を先に表示する', () => {
    /*
     * runs は loadMain（シナリオ＋集計）と別の流れで読み、
     * 操作後の更新も購読一覧＋集計の再取得（reloadRuns）に限定する。
     */
    expect(PAGE).toContain('void loadMain(seq)')
    expect(PAGE).toContain('void loadRuns(seq)')
    expect(PAGE).toContain('reloadRuns()')
    expect(PAGE).not.toContain('api.scenarios.runs(id, selectedAccountId, { limit: 50 })')
  })

  it('取れない開封・クリック・失敗数を0として作らない', () => {
    expect(PAGE).toContain("run?.opened.state === 'available'")
    expect(PAGE).toContain("run?.clicked.state === 'available'")
    expect(PAGE).toContain("step.failed.state === 'available'")
    expect(PAGE).toContain('runs?.steps')
    expect(PAGE).toContain("?.delivered")
    expect(PAGE).not.toContain('result?.reachedCount ?? 0')
    expect(PAGE).not.toContain('82.4%')
    expect(PAGE).not.toContain('46.1%')
  })
})
