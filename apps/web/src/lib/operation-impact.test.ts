import { describe, expect, it } from 'vitest'
import type { OperationImpactPreview } from './api'
import { operationImpactText } from './operation-impact'

const impact: OperationImpactPreview = {
  broadcast_dispatch: { itemCount: 2, friendCount: 1284, nearestScheduledAt: '2026-08-25T11:00:00.000Z' },
  scenario_dispatch: { itemCount: 4, friendCount: 381 },
  reminder_dispatch: { itemCount: 3, friendCount: 0 },
  automation_actions: { itemCount: 6, friendCount: 2, pendingCount: 3 },
  auto_reply_dispatch: { itemCount: 5, friendCount: null },
}

describe('operationImpactText', () => {
  it('実測人数と日本時間の予約を表示する', () => {
    expect(operationImpactText('broadcast_dispatch', impact))
      .toBe('2件（最も近い予約 8/25 20:00）／対象延べ1,284人')
    expect(operationImpactText('scenario_dispatch', impact)).toBe('4本／381人が進行中')
    expect(operationImpactText('reminder_dispatch', impact)).toBe('3本／対象0人')
    expect(operationImpactText('automation_actions', impact)).toBe('6本／実行待ち3件（2人）')
    expect(operationImpactText('auto_reply_dispatch', impact)).toBe('5本／次の受信から停止')
  })

  it('未取得を0人と表示しない', () => {
    expect(operationImpactText('broadcast_dispatch', {
      ...impact,
      broadcast_dispatch: { itemCount: 1, friendCount: null, nearestScheduledAt: null },
    })).toBe('1件／対象延べ—人')
    expect(operationImpactText('broadcast_dispatch', null)).toBe('影響を確認できません')
  })
})

/*
  **器が来ても、その中身まで来ているとは限らない。**
  口が形の違う返事をしたとき、`metric.friendCount` で画面ごと落ちていた。
  緊急停止の前に落ちると、止める手段そのものが無くなる。
*/
describe('影響の器が形どおりでないとき', () => {
  it('中身が無ければ落ちずに「確認できません」と言う', () => {
    const broken = {} as unknown as OperationImpactPreview
    expect(operationImpactText('broadcast_dispatch', broken)).toBe('影響を確認できません')
  })

  it('数でない値が来ても落ちない', () => {
    const broken = { broadcast_dispatch: { itemCount: null, friendCount: null } } as unknown as OperationImpactPreview
    expect(operationImpactText('broadcast_dispatch', broken)).toBe('影響を確認できません')
  })
})
