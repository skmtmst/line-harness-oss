import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const DIALOG = readFileSync(
  new URL('../../../components/scenarios/scenario-dialogs.tsx', import.meta.url),
  'utf8',
)
const API = readFileSync(new URL('../../../lib/api.ts', import.meta.url), 'utf8')

/*
 * IDEA-05（B段階導入）：既存のシナリオ確認（配信結果画面）の中で、
 * 選んだ検証顧客への配信予定・待機・分岐理由を表示する。
 * 外部送信なしで成立させるのが条件。
 */
describe('IDEA-05 友だち別の配信予定', () => {
  it('配信結果画面の中から試算口を呼ぶ', () => {
    expect(PAGE).toContain('FriendPlanDialog')
    expect(PAGE).toContain('友だちを選んで配信予定を見る')
    expect(PAGE).toContain('予定を見る')
    expect(API).toContain('friendPlan')
    expect(API).toContain('/api/scenarios/${id}/friends/${friendId}/plan')
    expect(DIALOG).toContain('api.scenarios.friendPlan')
  })

  it('送信・登録・タグ更新をしない確認だと画面に断る', () => {
    expect(DIALOG).toContain('送信・シナリオへの登録・タグの更新は行いません')
    // 試算口は sideEffects:false を契約として返す。
    expect(API).toContain('value.sideEffects === false')
  })

  it('動的条件は「未確定」と表示し、待機の正体（購読の状態）を出す', () => {
    expect(DIALOG).toContain('未確定')
    expect(DIALOG).toContain('step.dynamic')
    expect(DIALOG).toContain('止まっている理由')
    expect(DIALOG).toContain('まだ開始していません')
    expect(DIALOG).toContain('次の配信予定')
  })

  it('送れない・止まっている理由を隠さない', () => {
    expect(DIALOG).toContain('いまはこの友だちへ配信されません')
    expect(DIALOG).toContain('plan.start.reasons')
    expect(DIALOG).toContain('plan.warnings')
  })
})
