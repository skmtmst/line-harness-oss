import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* 完全切り替え：v7 の一覧 page.tsx は捨て、V8 を見る。入口は src/v8/scenarios/list.tsx（古い list-v8.tsx はもう描かれない）。 */
const LIST_PAGE = readFileSync(new URL('../../../v8/scenarios/list.tsx', import.meta.url), 'utf8')
const DETAIL_PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('./scenario-detail-client.tsx', import.meta.url), 'utf8')

describe('V6 シナリオ開始完了', () => {
  it('開始成功時だけ実Node NrBkW の完了画面へ進む', () => {
    // 一覧からの開始は詳細画面で行う（V8 の一覧に開始の口は無い）。
    expect(DETAIL_PAGE).toContain("searchParams.get('started') === '1'")
    expect(DETAIL_PAGE).toContain('showStarted={showStarted}')
    expect(DETAIL).toContain('data-design-node="NrBkW"')
  })

  it('完了画面は試算と開始記録の実値を使い、開始後の結果へ進める', () => {
    expect(DETAIL).toContain('api.scenarios.simulate(id, lineAccountId)')
    expect(DETAIL).toContain('api.scenarios.runs(id, lineAccountId, { limit: 50 })')
    expect(DETAIL).toContain('formatNumber(simulation.audience.newStartPlanned)')
    expect(DETAIL).toContain('開始履歴を確認')
    // 設計 B：状態の札は共通の StatusChip（旧「配信中」「配信可」「一時停止中」の直書き）。
    expect(DETAIL).toContain('<StatusChip')
    expect(DETAIL).not.toContain("? '配信中'")
    expect(DETAIL).toContain('runs?.subscriptions[0]?.startedAt')
    expect(DETAIL).toContain('開始日時を取得できませんでした')
    expect(DETAIL).toContain('/scenarios/results?id=')
    expect(DETAIL).not.toContain('開始予定116人')
  })

  it('停止時は完了画面へ移動せず一覧を読み直す', () => {
    // V8 の一覧はまとめての帯で止める・再開する。読み直しは一覧の口で行う。
    expect(LIST_PAGE).toContain('void loadScenarios()')
    expect(LIST_PAGE).toContain('まとめて止める')
  })
})
