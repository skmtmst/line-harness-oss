import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 機能20 分析', () => {
  it('V6の8タブと実Nodeを維持する', () => {
    for (const tab of [
      '友だちの増減', '配信の反応', '経路と成果', '使われ方',
      'クロス分析', 'ファネル', 'URLクリック', '保存した分析',
    ]) expect(PAGE).toContain(`label: '${tab}'`)

    for (const node of ['Zxezb', 'J6Inc', 'YBGtm', 'QQ1SR', 'f5HsX', 'C2I7ry', 'Fh2Qj', 'dfwD4']) {
      expect(PAGE).toContain(`data-design-node="${node}"`)
    }
  })

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
    expect(PAGE).toContain('Search Consoleを見る')
  })

  it('未取得の数値を0にせず、定義と結果を分けて保存する', () => {
    expect(PAGE).toContain("if (value.value === null) return '—'")
    expect(API).toContain('/api/analytics/saved?account_id=')
    expect(API).toContain('/api/analytics/saved/${id}/snapshots?account_id=')
    expect(PAGE).toContain('条件の定義と集計結果を分けて保存しています')
    expect(PAGE).toContain('保存時点の結果は書き換わりません')
    expect(PAGE).toContain('定期レポートは現在「なし」です')
    expect(PAGE).not.toContain('保存した分析はまだ接続されていません')
    expect(PAGE).toContain('DateTimeMetricCell metric={item.lastUsedAt}')
    expect(PAGE).toContain('<Th>集計状態</Th>')
    expect(PAGE).toContain('SAVED_STATE_LABELS[item.latestSnapshot.state]')
  })

  it('使われ方から中身の確認と片づけへ進め、取れない時間を作らない', () => {
    for (const text of [
      '使っている機能', '作ったのに使っていない', '自動で動いた回数',
      '手作業が減った時間', '気づいたこと', '中身を見る', '片づける',
      '利用関係を最後に確認',
    ]) expect(PAGE).toContain(text)
    expect(PAGE).toContain('overview.summary.estimatedHoursSaved.value')
    expect(PAGE).toContain('overview.summary.estimatedHoursSaved.reason')
    expect(PAGE).toContain('canTidyUsage(item)')
  })

  it('保存と個人一覧への移動は閲覧権限と分ける', () => {
    expect(PAGE).toContain("response.data.role === 'owner' || response.data.role === 'admin'")
    expect(PAGE).toContain('結果の保存と個人一覧への移動は、統括・管理者だけが行えます。')
    expect(PAGE).toContain('canManage && <Button onClick={() => void prepareCrossAudience()}')
    expect(PAGE).toContain('canManage && <Button onClick={() => void prepareFunnelAudience()}')
  })
})
