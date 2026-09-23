import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const TIME = readFileSync(new URL('./analytics-time.ts', import.meta.url), 'utf8')

/**
 * IDEA-20(台帳Issue #1038): 分析で指標の定義・母数・期間・更新時刻を明示し、
 * 未取得を0にしない契約。表と対象一覧が同じ条件を見ていることの確認口。
 */
describe('分析の期間と締切の明示', () => {
  it('「集計期間・データ締切」を出す共通の注記がある', () => {
    expect(PAGE).toContain('function AnalyticsPeriodCaption')
    expect(PAGE).toContain('データ締切 {formatAnalyticsDateTime(cutoffAt)}')
  })

  it('各タブが同じ注記で期間と締切を出す', () => {
    // 友だち・配信の反応・経路と成果・使われ方・URLクリック・クロス分析
    const uses = PAGE.match(/<AnalyticsPeriodCaption[\s>]/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(6)
  })

  it('ファネル結果と保存済み結果も期間と締切を出す', () => {
    expect(PAGE).toContain('集計期間 {formatAnalyticsDate(run.cohortFrom)}')
    expect(PAGE).toContain('データ締切 {formatAnalyticsDateTime(run.dataCutoffAt)}')
    expect(PAGE).toContain('データ締切 {formatAnalyticsDateTime(snapshot.dataCutoffAt)}')
  })

  it('集計待ちには次の更新のめどを伝える', () => {
    expect(PAGE).toContain('日ごとの集計は数分ごとに自動で更新されます')
  })
})

describe('未取得・未計測を0にしない', () => {
  it('曜日は端末の地域ではなく暦日(UTC)で決める', () => {
    // getDay()/toLocaleDateString は端末の地域を使い、日本より遅い地域では
    // 前日にずれる。日付列の曜日と日付表示は地域に依らない実装に固定する。
    expect(TIME).toContain('getUTCDay()')
    expect(PAGE).not.toContain('getDay()')
    expect(PAGE).not.toContain('toLocaleDateString')
  })

  it('グラフが描けない間は選択日の内訳を出さない', () => {
    // 「増加0人・減少0人・施策なし」は未取得の0を確定値に見せる。
    expect(PAGE).toContain('{daysShown && selectedDay && (')
    expect(PAGE).toContain('{daysShown && (')
  })
})
