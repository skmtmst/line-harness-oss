'use client'

import { useEffect, useState } from 'react'

export function insertDuplicateAfter<T extends { id: string }>(rows: readonly T[], sourceId: string, copy: T): T[] {
  const next = rows.filter((row) => row.id !== copy.id)
  const index = next.findIndex((row) => row.id === sourceId)
  next.splice(index < 0 ? 0 : index + 1, 0, copy)
  return next
}

/** 複製直後だけ、並びの指定より元の行のすぐ下を優先する。保存した順序は変えない。 */
export function useDuplicateFeedback(scope?: string | null) {
  const [recent, setRecent] = useState<{ sourceId: string; copyId: string } | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  useEffect(() => { setRecent(null); setHighlightedId(null) }, [scope])
  useEffect(() => {
    if (!highlightedId) return
    const timer = setTimeout(() => setHighlightedId(null), 1800)
    return () => clearTimeout(timer)
  }, [highlightedId])
  return {
    highlightedId,
    clear() { setRecent(null); setHighlightedId(null) },
    mark(sourceId: string, copyId: string) { setRecent({ sourceId, copyId }); setHighlightedId(copyId) },
    order<T extends { id: string }>(rows: readonly T[], allRows: readonly T[] = rows): readonly T[] {
      const copy = recent && rows.some((row) => row.id === recent.sourceId) && allRows.find((row) => row.id === recent.copyId)
      return copy && recent ? insertDuplicateAfter(rows, recent.sourceId, copy) : rows
    },
  }
}
