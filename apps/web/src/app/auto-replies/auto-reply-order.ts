/**
 * R28: 判定順（Worker と同じ）を一覧側で扱うための小さな関数群。
 *
 * 判定順は `priority` の小さい順・同じなら作った順（Worker の ORDER BY と
 * 同じ）。順番は一覧で上下を入れ替えて決め、窓の中では数字を打たせない。
 * 入れ替えは隣り合う2件の数字の交換だけで行い、同点のときだけ動かす側を
 * 1ずらす。上下の端で詰まった同点のときだけ全件を振り直す。
 */

export interface OrderedRule {
  id: string
  priority: number
  createdAt: string
}

/** Worker の受け付け範囲（`readPriority` と同じ）。 */
export const PRIORITY_MIN = -9999
export const PRIORITY_MAX = 9999

/** Worker の ORDER BY と同じ：小さいほど先・同じなら作った順。 */
export function inEvaluationOrder<T extends OrderedRule>(rules: T[]): T[] {
  return [...rules].sort(
    (a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt),
  )
}

export interface PriorityUpdate {
  id: string
  priority: number
}

/**
 * 隣との入れ替えに要る `priority` の更新だけを返す。
 *
 * `ordered` は `inEvaluationOrder` 済みの並び。動かせない位置・無い id の
 * ときは null。数字が違う2件は交換し、同点のときは動かす側を1ずらす。
 */
export function movePriorityUpdates(
  ordered: OrderedRule[],
  id: string,
  delta: -1 | 1,
): PriorityUpdate[] | null {
  const index = ordered.findIndex((rule) => rule.id === id)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return null
  const current = ordered[index]
  const neighbor = ordered[nextIndex]
  if (current.priority !== neighbor.priority) {
    return [
      { id: current.id, priority: neighbor.priority },
      { id: neighbor.id, priority: current.priority },
    ]
  }
  const moved = current.priority + delta
  if (moved >= PRIORITY_MIN && moved <= PRIORITY_MAX) {
    return [{ id: current.id, priority: moved }]
  }
  // 端で詰まった同点：順序だけ変えて全件を振り直す（変わる行だけ返す）。
  const reordered = [...ordered]
  const [picked] = reordered.splice(index, 1)
  reordered.splice(nextIndex, 0, picked)
  const updates: PriorityUpdate[] = []
  reordered.forEach((rule, position) => {
    if (rule.priority !== position) updates.push({ id: rule.id, priority: position })
  })
  return updates
}
