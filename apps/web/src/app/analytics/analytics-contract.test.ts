import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readApiSource(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe("管理画面 機能20 分析", () => {
  it('クロス分析とファネルは旧集計へ戻らず、版付きの不変結果を使う', () => {
    for (const path of [
      '/api/analytics/cross/query',
      '/api/analytics/cross/results/',
      '/api/analytics/funnels?account_id=',
      '/api/analytics/funnels/${funnelId}/runs/latest',
      '/api/analytics/funnels/${funnelId}/run',
      '/api/analytics/results/${resultId}/audiences',
    ]) expect(API).toContain(path)
    expect(PAGE).toContain('api.analytics.v6Funnels.list')
    expect(PAGE).toContain('api.analytics.runCross')
    expect(API).not.toContain('`/api/analytics/cross?account_id=')
    expect(PAGE).not.toContain('api.funnels.create')
    expect(PAGE).not.toContain('api.funnels.result')
  })

  it('既存の5つの読取APIを再利用し、本文タイトルを重ねない', () => {
    for (const path of [
      '/api/analytics/friends', '/api/analytics/reactions', '/api/analytics/routes',
      '/api/analytics/usage', '/api/analytics/url-clicks',
    ]) expect(API).toContain(path)
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('Google Analytics')
    expect(PAGE).toContain('Search Console を見る')
  })

  it('未取得の数値を0にせず、定義と結果を分けて保存する', () => {
    expect(PAGE).toContain("if (value.value === null) return '—'")
    expect(API).toContain('/api/analytics/saved?account_id=')
    expect(API).toContain('/api/analytics/saved/${id}/snapshots?account_id=')
    expect(PAGE).toContain('条件の定義と集計結果を分けて保存しています')
    expect(PAGE).toContain('保存時点の結果は書き換わりません')
    expect(PAGE).toContain('定期レポートは下の一覧で止めたり変えたりできます')
    expect(PAGE).toContain('api.analytics.reportSchedules')
    expect(PAGE).toContain('REPORT_STATUS_LABELS[schedule.status]')
    expect(PAGE).toContain('`/analytics/reports/new?id=${schedule.id}`')
    expect(PAGE).not.toContain('保存した分析はまだ接続されていません')
    expect(PAGE).toContain('shortWhen(item.lastUsedAt.value)')
    expect(PAGE).toContain('SAVED_STATE_LABELS[item.latestSnapshot.state]')
    expect(PAGE).toContain('SAVED_STATE_LABELS[item.latestSnapshot.state]')
  })

  it('使われ方から中身の確認と片づけへ進め、取れない時間を作らない', () => {
    for (const text of [
      '使っている機能', '作ったのに使っていない', '自動で動いた回数',
      '手作業が減った時間', '気づいたこと', '中身を見る', '片づける',
      '利用関係を最後に確認',
    ]) expect(PAGE).toContain(text)
    expect(PAGE).toContain('const hours = overview.summary.estimatedHoursSaved')
    expect(PAGE).toContain('hours.reason')
    expect(PAGE).toContain('canTidyUsage(item)')
  })

  it('保存と個人一覧への移動は閲覧権限と分ける', () => {
    expect(PAGE).toContain("const canManage = canManageRole(role)")
    expect(PAGE).toContain('結果の保存と対象者づくりは、統括・管理者だけが行えます。')
    expect(PAGE).toContain('picked && canManage ?')
    expect(PAGE).toContain('{canManage ? <>')
  })

  it('結果待ちは打ち切りと間隔延長があり、無限に叩かない(点検#508の中2)', () => {
    expect(PAGE).not.toContain('setInterval')
    // board #633独立差し戻し: 2分で止めず5分cronを待つ。打ち切りは最短目安+余裕(上限あり)。
    // board #633独立審査: 確認失敗のbackoffを積む前にも打ち切りを見る。
    expect(PAGE).toContain('stopIfDeadlinePassed')
    expect(PAGE).toContain('Date.now() < deadline')
    expect(PAGE).toContain('CROSS_AUTO_POLL_MAX_MS')
    // board #633独立再審査: 打ち切り後もrunを保持し再接続する。新規の送り直しは促さない。
    expect(PAGE).toContain('自動の確認を止めました')
    expect(PAGE).toContain('結果をもう一度確認')
    expect(PAGE).not.toContain('時間切れです。条件をゆるめて集計し直してください')
    expect(PAGE).toContain('attempts < 10 ? 3000 : 10000')
  })

  it('クロス分析は「数えるもの」を選べ、期間・棒・段は読み上げに届く(#951)', () => {
    // N-276: 人数だけでなく、記録が「取得可能」なイベントの回数でも数えられる。
    expect(API).toContain('AnalyticsCrossMeasure')
    expect(PAGE).toContain("id=\"cross-measure\"")
    expect(PAGE).toContain("id=\"cross-measure-event\"")
    expect(PAGE).toContain("kind: 'events'")
    // N-288: 期間切替は選択状態を持ち、棒・段は名前を持つ。
    expect(readFileSync(new URL('../../components/shared/segmented.tsx', import.meta.url), 'utf8')).toContain('aria-pressed={option.value === value}')
    expect(PAGE).toContain('label="全体の流れ" disabled={!measurable}')
  })

  it('一覧の取得失敗は空表示と分け、再読込の導線と実行制限は運用の言葉で出す(点検#508の中3・中4)', () => {
    expect(PAGE).toContain('友だち情報欄を読み込めませんでした。')
    expect(PAGE).toContain('ファネルを読み込めませんでした。')
    // 開き直ししかできなかったエラー面には、同じ条件で読み直す導線を付ける。
    // ★管理画面 `x63W5x`：ボタンの文言は共通部品（ListState）が持つ。ここでは口があることだけ見る。
    expect(PAGE).toContain('onRetry')
    expect(PAGE).toContain('fieldsReload')
    expect(PAGE).toContain('funnelsReload')
    expect(PAGE).toContain('savedReload')
    expect(PAGE).toContain('snapshotReload')
    expect(PAGE).toContain('menuReload')
    expect(PAGE).toContain('analytics_cross_busy')
    expect(PAGE).toContain('他の集計が動いています。終わってからもう一度押してください')
    expect(PAGE).toContain('analytics_funnel_too_soon')
    expect(PAGE).toContain('さきほど集計したばかりです。少し待ってから押してください')
  })

  it('200件で切れるときは注意を出し、CSVも範囲内と書く(点検#508の中5)', () => {
    expect(PAGE).toContain('overview.hasMore')
    // 監査 R72: 検索は200件の外へも届くようになったので、注意文もその旨に更新した。
    expect(PAGE).toContain('条件に合うもののうち200件までを表示しています。探す言葉で絞るとこの中だけではなく全体から探します。CSVの書き出しも、表示している範囲だけが入ります。')
  })

  it('未集計のファネルは壊れた表示にせず案内を出す(点検#508軽13)', () => {
    expect(PAGE).toContain('setNoRun')
    expect(PAGE).toContain('<AggregationStatus')
    expect(PAGE).toContain("{ kind: 'empty' }")
    expect(PAGE).toContain('onRun={() => void runNow()}')
  })
})
