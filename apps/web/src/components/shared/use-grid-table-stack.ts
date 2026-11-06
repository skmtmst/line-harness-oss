'use client'

import { useLayoutEffect, type RefObject } from 'react'
import { observeElementResize } from './element-resize-observer'

/**
 * 名前の列（1 列目）がこの幅を切ったら、行を 2 段にする（1 段目に名前、2 段目にほかの列）。
 * 決まった画面の幅ではなく、表に入りきるかで決めるので、iPad 縦（834px）でも同じ直しが効く。
 */
export const GRID_TABLE_NAME_MIN = 96

/** 列の指定を一番外の空白で分ける。`minmax(0, 1fr)` の中の空白では分けない。 */
export function splitGridTracks(columns: string): string[] {
  const tracks: string[] = []
  let depth = 0
  let current = ''
  for (const char of columns.trim()) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (/\s/.test(char) && depth === 0) {
      if (current) tracks.push(current)
      current = ''
    } else current += char
  }
  if (current) tracks.push(current)
  return tracks
}

/** 1 列目が伸び縮みする列で、ほかに列がある表だけが 2 段になれる。 */
export function canStackGridTable(columns: string): boolean {
  const tracks = splitGridTracks(columns)
  return tracks.length >= 2 && /fr\b/.test(tracks[0])
}

/** 2 段にした時の 2 段目の列（1 列目を除いた列）。表の style の --grid-table-rest-columns に渡す。 */
export function restGridTracks(columns: string): string {
  return splitGridTracks(columns).slice(1).join(' ')
}

/**
 * 名前の列が細すぎる時だけ表に data-stacked を付ける。
 * 2 段にした時の表の幅を覚え、それより広がったら 1 段へ戻して測り直す。
 */
export function useGridTableStack(ref: RefObject<HTMLElement | null>, columns: string, enabled: boolean) {
  useLayoutEffect(() => {
    const table = ref.current
    if (!table) return
    if (!enabled || !canStackGridTable(columns)) {
      delete table.dataset.stacked
      return
    }
    let stackedAt = 0
    const measure = () => {
      const width = table.clientWidth
      if (table.dataset.stacked !== undefined) {
        if (width <= stackedAt + 1) return
        delete table.dataset.stacked
      }
      const name = table.querySelector('[role="row"]')?.firstElementChild
      const nameWidth = name?.getBoundingClientRect().width ?? 0
      if (nameWidth > 0 && nameWidth < GRID_TABLE_NAME_MIN) {
        table.dataset.stacked = ''
        stackedAt = width
      }
    }
    measure()
    const stop = observeElementResize([table], measure)
    return () => {
      stop()
      delete table.dataset.stacked
    }
  }, [ref, columns, enabled])
}
