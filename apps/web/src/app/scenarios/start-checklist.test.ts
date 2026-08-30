import { describe, expect, test } from 'vitest'
import type { Scenario } from '@line-crm/shared'
import { shouldShowStartChecklist, startChecklist } from './start-checklist'

const base = (over: Record<string, unknown> = {}) =>
  ({ triggerType: 'friend_add', stepCount: 3, ...over }) as unknown as Scenario & {
    stepCount?: number
  }

describe('startChecklist', () => {
  test('設計の4項目をこの順で並べる', () => {
    expect(startChecklist(base()).map((i) => i.label)).toEqual([
      '開始条件が設定されています',
      'すべての通に配信タイミングがあります',
      'テスト送信が終わっています',
      'LINE公式の送信枠を超えていません',
    ])
  })

  test('確かめられない2項目は unknown のままで、確認済みにしない', () => {
    const out = startChecklist(base())
    expect(out[2].state).toBe('unknown')
    expect(out[3].state).toBe('unknown')
    expect(out[2].detail).toContain('—（未取得）')
    expect(out[3].detail).toContain('—（未取得）')
  })

  test('きっかけが無ければ warn', () => {
    expect(startChecklist(base({ triggerType: null }))[0].state).toBe('warn')
  })

  test('通が0なら warn。誰にも届かないため', () => {
    const out = startChecklist(base({ stepCount: 0 }))
    expect(out[1].state).toBe('warn')
    expect(out[1].detail).toContain('通が1つもありません')
  })

  test('通数が取れないときは 0 と混ぜず unknown', () => {
    const out = startChecklist(base({ stepCount: undefined }))
    expect(out[1].state).toBe('unknown')
    expect(out[1].detail).toContain('—（未取得）')
  })

  test('止める側では出さない', () => {
    expect(shouldShowStartChecklist(true)).toBe(false)
    expect(shouldShowStartChecklist(false)).toBe(true)
  })
})
