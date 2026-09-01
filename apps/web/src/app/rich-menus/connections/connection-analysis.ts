export type ConnectionArea = {
  actionType: string
  actionData: Record<string, unknown>
  label: string | null
}

export type ConnectionPage = {
  id: string
  name: string
  orderIndex: number
  lineRichmenuId: string | null
  areas: ConnectionArea[]
}

export type ConnectionEdge = {
  fromPageId: string
  targetPageId: string | null
  label: string
}

export type ConnectionAnalysis = {
  entryPageId: string | null
  edges: ConnectionEdge[]
  reachablePageIds: Set<string>
  returnablePageIds: Set<string>
  missingTargetEdges: ConnectionEdge[]
  unreachablePageIds: Set<string>
  cannotReturnPageIds: Set<string>
  selfOnlyPageIds: Set<string>
}

function targetPageId(area: ConnectionArea): string | null {
  const value = area.actionData.targetPageId
  return typeof value === 'string' && value.length > 0 ? value : null
}

function visit(start: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next)
    }
  }
  return visited
}

/**
 * 保存済みの page と richmenuswitch だけから、到達不能・戻れない・参照切れを調べる。
 * LINE上の現在値や条件は推測しない。
 */
export function analyzeConnections(
  pages: ConnectionPage[],
  defaultPageId: string | null,
): ConnectionAnalysis {
  const sorted = [...pages].sort((a, b) => a.orderIndex - b.orderIndex)
  const pageIds = new Set(sorted.map((page) => page.id))
  const entryPageId = defaultPageId && pageIds.has(defaultPageId)
    ? defaultPageId
    : (sorted[0]?.id ?? null)

  const edges: ConnectionEdge[] = []
  for (const page of sorted) {
    page.areas.forEach((area, index) => {
      if (area.actionType !== 'richmenuswitch') return
      edges.push({
        fromPageId: page.id,
        targetPageId: targetPageId(area),
        label: area.label?.trim() || `切替ボタン ${index + 1}`,
      })
    })
  }

  const validEdges = edges.filter(
    (edge): edge is ConnectionEdge & { targetPageId: string } =>
      edge.targetPageId !== null && pageIds.has(edge.targetPageId),
  )
  const adjacency = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  for (const page of sorted) {
    adjacency.set(page.id, [])
    reverse.set(page.id, [])
  }
  for (const edge of validEdges) {
    adjacency.get(edge.fromPageId)?.push(edge.targetPageId)
    reverse.get(edge.targetPageId)?.push(edge.fromPageId)
  }

  const reachablePageIds = entryPageId ? visit(entryPageId, adjacency) : new Set<string>()
  const returnablePageIds = entryPageId ? visit(entryPageId, reverse) : new Set<string>()
  const unreachablePageIds = new Set(sorted.filter((page) => !reachablePageIds.has(page.id)).map((page) => page.id))
  const cannotReturnPageIds = new Set(
    sorted
      .filter((page) => page.id !== entryPageId && reachablePageIds.has(page.id) && !returnablePageIds.has(page.id))
      .map((page) => page.id),
  )
  const selfOnlyPageIds = new Set(
    sorted
      .filter((page) => {
        const outgoing = validEdges.filter((edge) => edge.fromPageId === page.id)
        return outgoing.length > 0 && outgoing.every((edge) => edge.targetPageId === page.id)
      })
      .map((page) => page.id),
  )

  return {
    entryPageId,
    edges,
    reachablePageIds,
    returnablePageIds,
    missingTargetEdges: edges.filter(
      (edge) => edge.targetPageId === null || !pageIds.has(edge.targetPageId),
    ),
    unreachablePageIds,
    cannotReturnPageIds,
    selfOnlyPageIds,
  }
}
