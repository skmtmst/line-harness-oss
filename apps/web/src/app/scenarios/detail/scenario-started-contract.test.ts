import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * 始めた直後の知らせ（試算の人数・開始の記録・配信結果への行き先）は v8/scenario-detail/detail-actions.test.tsx、
 * 一覧のまとめて止める→読み直しは v8/scenarios/list-filters-and-folders.test.tsx が画面を描いて守る。
 * ここには戻してはいけない書き方の見張りだけを残す。
 */
const DETAIL = readFileSync(new URL('./scenario-detail-client.tsx', import.meta.url), 'utf8')

describe("管理画面 シナリオ開始完了", () => {
  it('状態の札を直書きせず、固定の見本の人数を出さない', () => {
    // 設計 B：状態の札は共通の StatusBadge（旧「配信中」「配信可」「一時停止中」の直書き）。
    expect(DETAIL).not.toContain("? '配信中'")
    expect(DETAIL).not.toContain('開始予定116人')
  })
})
