import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('../detail/scenario-detail-client.tsx', import.meta.url), 'utf8')

describe('V6 5-1-L シナリオ配信結果', () => {
  it('実Node IDとシナリオ・統計・開始記録APIを使う', () => {
    expect(PAGE).toContain('data-design-node="M2b2B"')
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
    expect(PAGE).toContain('購読一覧を表示できませんでした')
    expect(PAGE).toContain('onRetry={() => void loadRuns(loadSeqRef.current)}')
    expect(PAGE).toContain('購読一覧を読み込んでいます')
    expect(PAGE).toContain('購読している友だちはまだいません')
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
    expect(PAGE).toContain('さらに読み込む')
    expect(PAGE).toContain('status: subscriptionStatus || undefined')
    expect(PAGE).toContain('aria-label="購読の状態で絞り込む"')
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
    expect(PAGE).toContain("run?.opened.value ?? '—'")
    expect(PAGE).toContain("run?.clicked.value ?? '—'")
    expect(PAGE).toContain('runs?.steps[0]?.failed.reason')
    expect(PAGE).toContain('<div><dt>エラー</dt><dd>—</dd></div>')
    expect(PAGE).toContain('LINEでは通ごとの開封・クリック・失敗をすべて取得できません')
    expect(PAGE).toContain('run?.delivered ?? result?.reachedCount')
    expect(PAGE).not.toContain('result?.reachedCount ?? 0')
    expect(PAGE).not.toContain('82.4%')
    expect(PAGE).not.toContain('46.1%')
  })

  it('本文タイトルを重ねず、CSVと編集への戻りを備える', () => {
    expect(PAGE).toContain('usePageTitle(')
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
    expect(PAGE).toContain('CSVで書き出す')
    expect(PAGE).toContain('シナリオ編集へ戻る')
  })
})
