import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LIST_PAGE = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8')
const DETAIL_PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('./scenario-detail-client.tsx', import.meta.url), 'utf8')

describe('V6 シナリオ開始完了', () => {
  it('開始成功時だけ実Node NrBkW の完了画面へ進む', () => {
    expect(LIST_PAGE).toContain("router.push(`/scenarios/detail?id=${encodeURIComponent(target.id)}&started=1`)")
    expect(DETAIL_PAGE).toContain("searchParams.get('started') === '1'")
    expect(DETAIL_PAGE).toContain('showStarted={showStarted}')
    expect(DETAIL).toContain('data-design-node="NrBkW"')
  })

  it('完了画面は試算と開始記録の実値を使い、開始後の結果へ進める', () => {
    expect(DETAIL).toContain('api.scenarios.simulate(id, lineAccountId)')
    expect(DETAIL).toContain('api.scenarios.runs(id, lineAccountId, { limit: 50 })')
    expect(DETAIL).toContain('simulation.audience.newStartPlanned.toLocaleString')
    expect(DETAIL).toContain('開始履歴を確認')
    expect(DETAIL).toContain("showStarted ? '配信中'")
    expect(DETAIL).toContain('runs?.subscriptions[0]?.startedAt')
    expect(DETAIL).toContain('開始日時を取得できませんでした')
    expect(DETAIL).toContain('/scenarios/results?id=')
    expect(DETAIL).not.toContain('開始予定116人')
  })

  it('開始条件の撮影は同じ文言の別ボタンに依存しない', () => {
    expect(DETAIL).toContain('qaOpen="EvVO5"')
    expect(DETAIL).toContain('data-qa-open={qaOpen}')
  })

  it('停止時は完了画面へ移動せず一覧を読み直す', () => {
    expect(LIST_PAGE).toContain('if (target.isActive)')
    expect(LIST_PAGE).toContain('void loadScenarios()')
  })
})
