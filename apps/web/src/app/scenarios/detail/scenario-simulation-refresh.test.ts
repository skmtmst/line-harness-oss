import { describe, expect, it } from 'vitest'

import {
  scenarioSimulationKey,
  simulationForKey,
  type ScenarioSimulationResult,
} from './scenario-simulation-refresh'

/*
 * SCENARIO-15: 対象条件・通・時刻を保存し直したあと、開始予定人数などの
 * 試算が更新されない問題の受け口。試算の元になる値が変わると鍵が変わり、
 * 変わらなければ同じ鍵に留まる（余計な取り直しをしない）。
 */

const step = (over: Record<string, unknown> = {}) => ({
  id: 'st-1',
  stepOrder: 1,
  delayMinutes: 0,
  offsetDays: 0,
  offsetMinutes: 0,
  deliveryTime: '09:00',
  targetCondition: null,
  isDraft: false,
  ...over,
})

const base = {
  lineAccountId: 'acc-1',
  audienceCondition: null,
  allowConcurrent: true,
  triggerType: 'friend_add',
  steps: [step()],
} as never

describe('scenarioSimulationKey', () => {
  it('シナリオが無いときは空の鍵（未取得と同じ扱い）', () => {
    expect(scenarioSimulationKey(null, 0)).toBe('')
  })

  it('同じ設定なら同じ鍵（余計な取り直しをしない）', () => {
    expect(scenarioSimulationKey(base, 1)).toBe(scenarioSimulationKey(base, 1))
  })

  it('対象条件を保存し直すと鍵が変わる', () => {
    const next = {
      ...base,
      audienceCondition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 't1' }] },
    } as never
    expect(scenarioSimulationKey(next, 1)).not.toBe(scenarioSimulationKey(base, 1))
  })

  it('通の追加・削除で鍵が変わる', () => {
    const added = { ...base, steps: [step(), step({ id: 'st-2', stepOrder: 2 })] } as never
    expect(scenarioSimulationKey(added, 1)).not.toBe(scenarioSimulationKey(base, 1))
    const removed = { ...base, steps: [] } as never
    expect(scenarioSimulationKey(removed, 1)).not.toBe(scenarioSimulationKey(base, 1))
  })

  it('通の時刻・順序・絞り込み・下書きの変更で鍵が変わる', () => {
    const cases = [
      { ...base, steps: [step({ deliveryTime: '18:30' })] },
      { ...base, steps: [step({ offsetDays: 3 })] },
      { ...base, steps: [step({ offsetMinutes: 90 })] },
      { ...base, steps: [step({ delayMinutes: 60 })] },
      { ...base, steps: [step({ stepOrder: 2 })] },
      { ...base, steps: [step({ targetCondition: { operator: 'AND', rules: [] } })] },
      { ...base, steps: [step({ isDraft: true })] },
    ] as never[]
    for (const next of cases) {
      expect(scenarioSimulationKey(next, 1)).not.toBe(scenarioSimulationKey(base, 1))
    }
  })

  it('開始のきっかけの件数・同時購読の別・アカウントで鍵が変わる', () => {
    expect(scenarioSimulationKey(base, 2)).not.toBe(scenarioSimulationKey(base, 1))
    expect(scenarioSimulationKey({ ...base, allowConcurrent: false } as never, 1)).not.toBe(
      scenarioSimulationKey(base, 1),
    )
    expect(scenarioSimulationKey({ ...base, lineAccountId: 'acc-2' } as never, 1)).not.toBe(
      scenarioSimulationKey(base, 1),
    )
  })
})

describe('simulationForKey', () => {
  const result: ScenarioSimulationResult = {
    key: 'old-key',
    value: {
      scenarioId: 'sc-1',
      lineAccountId: 'acc-1',
      computedAt: '2026-09-21T00:00:00Z',
      sideEffects: false,
      audience: { accountTotal: 10, matched: 5, alreadySubscribed: 0, newStartPlanned: 5, excluded: 5 },
      steps: [],
    },
  }

  it('鍵が合う結果だけを返す', () => {
    expect(simulationForKey(result, 'old-key')).toBe(result.value)
  })

  it('設定変更後の鍵には旧結果を返さない（古い値を確定値にしない）', () => {
    expect(simulationForKey(result, 'new-key')).toBeNull()
    expect(simulationForKey(result, '')).toBeNull()
    expect(simulationForKey(null, 'new-key')).toBeNull()
  })
})
