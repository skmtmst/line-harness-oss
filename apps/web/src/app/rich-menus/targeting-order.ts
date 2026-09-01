export type TargetingOrderItem = {
  id: string
  targetingPriority: number
  createdAt: string
}

export function compareTargetingGroups(
  a: TargetingOrderItem,
  b: TargetingOrderItem,
): number {
  return a.targetingPriority - b.targetingPriority || a.createdAt.localeCompare(b.createdAt)
}

/** Workerが友だちへ出すメニューを選ぶ順番と同じ並び。 */
export function orderTargetingGroups<T extends TargetingOrderItem>(groups: T[]): T[] {
  return [...groups].sort(compareTargetingGroups)
}

/**
 * 1件を上下へ動かし、古い同順位データも含めて0,1,2…へ正規化する。
 * 範囲外へ動かそうとした場合は、書き込みを起こさないためnullを返す。
 */
export function moveTargetingGroup<T extends TargetingOrderItem>(
  groups: T[],
  groupId: string,
  delta: -1 | 1,
): Array<{ id: string; priority: number }> | null {
  const reordered = orderTargetingGroups(groups)
  const index = reordered.findIndex((group) => group.id === groupId)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= reordered.length) return null

  ;[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]]
  return reordered.map((group, priority) => ({ id: group.id, priority }))
}
