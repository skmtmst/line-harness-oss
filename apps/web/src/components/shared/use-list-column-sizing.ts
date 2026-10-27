'use client'
import { useLayoutEffect, type RefObject } from 'react'
import { fitGridContentColumns } from './grid-content-columns.mjs'
import { fitListColumns } from './list-column-sizing.mjs'

export function useListColumnSizing(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const frame = ref.current
    if (!enabled || !frame) return
    let active = true, request = 0
    const measure = () => {
      cancelAnimationFrame(request)
      request = requestAnimationFrame(() => { if (active) { if (frame.getAttribute('role') === 'table') fitGridContentColumns(frame); else fitListColumns(frame) } })
    }
    // 幅を測るための見えない写しの出し入れでは測り直さない。
    const probeOnly = (records: MutationRecord[]) => records.every(record => record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node instanceof HTMLElement && node.hasAttribute('data-column-probe')))
    const mutation = new MutationObserver(records => { if (!probeOnly(records)) measure() })
    mutation.observe(frame, { childList: true, subtree: true, characterData: true })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(frame)
    measure()
    void document.fonts?.ready.then(() => { if (active) { (frame as HTMLDivElement & { listColumnScope?: string }).listColumnScope = ''; measure() } })
    return () => { active = false; cancelAnimationFrame(request); mutation.disconnect(); resize?.disconnect() }
  }, [ref, enabled])
}
