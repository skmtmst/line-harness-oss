import { describe, expect, test } from 'vitest'
import type { AutoReplyDryRunResult, AutoReplyValidationResult } from '@line-crm/shared'
import { canPublish, conflictTone, publishGates } from './publish-flow'

const conflict = (id: string, certainty: 'certain' | 'possible', winner: string) => ({
  autoReplyId: id, name: id, certainty, winnerAutoReplyId: winner, reason: '',
})
const validation = (over: Partial<AutoReplyValidationResult> = {}): AutoReplyValidationResult =>
  ({ valid: true, errors: [], warnings: [], conflicts: [], lastTestStatus: 'succeeded', ...over })
const dryRun = (over: Partial<AutoReplyDryRunResult> = {}): AutoReplyDryRunResult =>
  ({
    matched: true, draftWon: true, winner: null, candidates: [], actions: [],
    stateChanged: false, ...over,
  }) as AutoReplyDryRunResult

describe('publishGates', () => {
  test('確かめていない項目は unknown で、確認済みにしない', () => {
    const gates = publishGates(null, null, new Set())
    expect(gates.every((g) => g.state === 'unknown')).toBe(true)
    expect(gates.every((g) => g.detail.includes('—（未取得）'))).toBe(true)
  })

  test('未確認の競合が残っていれば止める', () => {
    const gates = publishGates(
      validation({ conflicts: [conflict('ar-1', 'certain', 'ar-1')] }),
      dryRun(),
      new Set(),
    )
    expect(gates[0].state).toBe('blocked')
    expect(gates[0].detail).toContain('1件が未確認')
  })

  test('全部確認すれば通る', () => {
    const gates = publishGates(
      validation({ conflicts: [conflict('ar-1', 'certain', 'ar-1')] }),
      dryRun(),
      new Set(['ar-1']),
    )
    expect(gates[0].state).toBe('ok')
  })

  test('試験で下書きが負けたら止め、勝った相手を名前で出す', () => {
    const gates = publishGates(
      validation(),
      dryRun({ draftWon: false, winner: { autoReplyId: 'ar-1', name: '一律返信', responseType: 'text', responseContent: '' } }),
      new Set(),
    )
    expect(gates[1].state).toBe('blocked')
    expect(gates[1].detail).toContain('一律返信')
  })

  test('入力の不足はそのまま出す', () => {
    const gates = publishGates(validation({ errors: ['キーワードがありません'] }), dryRun(), new Set())
    expect(gates[2].state).toBe('blocked')
    expect(gates[2].detail).toContain('キーワードがありません')
  })
})

describe('canPublish', () => {
  test('すべて ok のときだけ押せる', () => {
    expect(canPublish(publishGates(validation(), dryRun(), new Set()))).toBe(true)
  })

  test('unknown が1つでもあれば押せない。確かめていないものを確かめた扱いにしない', () => {
    expect(canPublish(publishGates(validation(), null, new Set()))).toBe(false)
  })

  test('blocked が1つでもあれば押せない', () => {
    expect(canPublish(publishGates(validation({ errors: ['x'] }), dryRun(), new Set()))).toBe(false)
  })

  test('段が空なら押せない', () => {
    expect(canPublish([])).toBe(false)
  })
})

describe('conflictTone', () => {
  test('確かなものと、そうでないものを分ける', () => {
    expect(conflictTone(conflict('a', 'certain', 'a'), 'ar-2').label).toBe('必ず重なります')
    expect(conflictTone(conflict('a', 'possible', 'a'), 'ar-2').label).toBe('重なることがあります')
  })

  test('この下書きが負ける組み合わせが分かる', () => {
    expect(conflictTone(conflict('a', 'certain', 'ar-1'), 'ar-2').losing).toBe(true)
    expect(conflictTone(conflict('a', 'certain', 'ar-2'), 'ar-2').losing).toBe(false)
  })
})
