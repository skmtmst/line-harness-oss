/*
 * src/v8/auto-replies/order.ts の試験。元の app/auto-replies/auto-reply-order.test.ts と同じ中身
 * （2026-10-06 に写した。元の試験は切り替えの日まで残す）。中身を変えるときは両方を直す。
 */
import { describe, expect, it } from 'vitest'
import {
  inEvaluationOrder,
  movePriorityUpdates,
  type OrderedRule,
} from './order'

/**
 * 監査 R28（優先順位の説明が逆）の順番操作の契約。
 *
 * 判定順は Worker と同じ「priority の小さい順・同じなら作った順」。
 * 順番は一覧で上下を入れ替えて決め、数字は打たせない。
 * 入れ替えは隣り合う2件の数字の交換だけで行い、同点のときだけ
 * 動かす側を1ずらす。端で詰まったときだけ全件を振り直す。
 */
const rule = (id: string, priority: number, createdAt = '2026-09-01T00:00:00.000Z'): OrderedRule => ({
  id,
  priority,
  createdAt,
})

describe('inEvaluationOrder: Worker と同じ順番に並べる', () => {
  it('小さいほど先・同じなら作った順', () => {
    const ordered = inEvaluationOrder([
      rule('p14', 14),
      rule('p3', 3),
      rule('new', 3, '2026-09-02T00:00:00.000Z'),
    ])
    expect(ordered.map((r) => r.id)).toEqual(['p3', 'new', 'p14'])
  })

  it('元の配列を壊さない', () => {
    const input = [rule('b', 2), rule('a', 1)]
    inEvaluationOrder(input)
    expect(input.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('movePriorityUpdates: 隣との入れ替えに要る更新だけ返す', () => {
  it('数字が違う2件は交換する', () => {
    const ordered = inEvaluationOrder([rule('a', 10), rule('b', 20)])
    expect(movePriorityUpdates(ordered, 'b', -1)).toEqual([
      { id: 'b', priority: 10 },
      { id: 'a', priority: 20 },
    ])
  })

  it('下へ動かすときも交換する', () => {
    const ordered = inEvaluationOrder([rule('a', 10), rule('b', 20)])
    expect(movePriorityUpdates(ordered, 'a', 1)).toEqual([
      { id: 'a', priority: 20 },
      { id: 'b', priority: 10 },
    ])
  })

  it('同点で上へ動かすときは動かす側を1小さくする', () => {
    const ordered = inEvaluationOrder([
      rule('a', 10, '2026-09-01T00:00:00.000Z'),
      rule('b', 10, '2026-09-02T00:00:00.000Z'),
    ])
    expect(movePriorityUpdates(ordered, 'b', -1)).toEqual([{ id: 'b', priority: 9 }])
  })

  it('同点で下へ動かすときは動かす側を1大きくする', () => {
    const ordered = inEvaluationOrder([
      rule('a', 10, '2026-09-01T00:00:00.000Z'),
      rule('b', 10, '2026-09-02T00:00:00.000Z'),
    ])
    expect(movePriorityUpdates(ordered, 'a', 1)).toEqual([{ id: 'a', priority: 11 }])
  })

  it('端では動かさない（null）', () => {
    const ordered = inEvaluationOrder([rule('a', 10), rule('b', 20)])
    expect(movePriorityUpdates(ordered, 'a', -1)).toBeNull()
    expect(movePriorityUpdates(ordered, 'b', 1)).toBeNull()
  })

  it('無い id では動かさない（null）', () => {
    expect(movePriorityUpdates(inEvaluationOrder([rule('a', 10)]), 'z', -1)).toBeNull()
  })

  it('下限で詰まった同点は全件を振り直す（-9999 を保ったまま順序だけ変える）', () => {
    const ordered = inEvaluationOrder([
      rule('a', -9999, '2026-09-01T00:00:00.000Z'),
      rule('b', -9999, '2026-09-02T00:00:00.000Z'),
    ])
    const updates = movePriorityUpdates(ordered, 'b', -1)
    expect(updates).not.toBeNull()
    // b が a より先になる割り当てで、範囲内に収まる
    const applied = new Map(ordered.map((r) => [r.id, r.priority]))
    for (const u of updates!) applied.set(u.id, u.priority)
    expect([...applied.values()].every((p) => p >= -9999 && p <= 9999)).toBe(true)
    const rebuilt = inEvaluationOrder(
      ordered.map((r) => ({ ...r, priority: applied.get(r.id)! })),
    )
    expect(rebuilt.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

it('WEB083: 同点3件の末尾を1つ上へ動かしても先頭へ飛ばない', () => {
  const input = ['a', 'b', 'c'].map((id, i) => rule(id, 10, `2026-09-0${i + 1}T00:00:00Z`))
  const updates = new Map(movePriorityUpdates(input, 'c', -1)!.map(u => [u.id, u.priority]))
  expect(inEvaluationOrder(input.map(r => ({ ...r, priority: updates.get(r.id) ?? r.priority }))).map(r => r.id)).toEqual(['a', 'c', 'b'])
})

it('WEB085: 個別を共通より先、同点ではキーワードを全メッセージより先に評価する', () => {
  const input = [
    { ...rule('common', 0), lineAccountId: null, respondToAll: false },
    { ...rule('all', 10, '2026-09-01'), lineAccountId: 'a', respondToAll: true },
    { ...rule('keyword', 10, '2026-09-02'), lineAccountId: 'a', respondToAll: false },
  ]
  expect(inEvaluationOrder(input).map(r => r.id)).toEqual(['keyword', 'all', 'common'])
})

it('WEB083: 異なる順位の交換でも3件目の同点を飛び越さない',()=>{
 const input=[rule('a',0,'2026-09-03'),rule('b',1,'2026-09-01'),rule('c',1,'2026-09-02')]
 const updates=new Map(movePriorityUpdates(input,'a',1)!.map(u=>[u.id,u.priority]))
 expect(inEvaluationOrder(input.map(r=>({...r,priority:updates.get(r.id)??r.priority}))).map(r=>r.id)).toEqual(['b','a','c'])
});
