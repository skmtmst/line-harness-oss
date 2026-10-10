'use client'
import { useLayoutEffect, useRef } from 'react'

/** B-192：横の箱は自然な高さの差48以内だけそろえる。縦並びでは解除する。 */
const groups = new WeakMap<HTMLElement, { users: number; release: () => void }>()
export function useCardHeights() {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const view = parent.ownerDocument.defaultView
    if (!view?.requestAnimationFrame || !view.cancelAnimationFrame) return
    const existing = groups.get(parent)
    if (existing) existing.users++
    else {
      let frame = 0, width = -1
      const originals = new Map<HTMLElement, string>()
      const measure = () => {
        view.cancelAnimationFrame(frame)
        frame = view.requestAnimationFrame(() => {
          const cards = [...parent.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-design-part="card"]'))
          if (cards.length < 2 || document.documentElement.dataset.theme !== 'v8') return
          const layout = getComputedStyle(parent)
          const horizontal = layout.display.includes('grid') || layout.display.includes('flex') && layout.flexDirection === 'row'
          for (const card of cards) {
            if (!originals.has(card)) originals.set(card, card.style.cssText)
            card.style.minHeight = '0'; card.style.height = 'auto'; card.style.alignSelf = 'flex-start'
          }
          if (!horizontal) return
          const rows = new Map<number, HTMLElement[]>()
          for (const card of cards) {
            const y = Math.round(card.getBoundingClientRect().top / 4)
            rows.set(y, [...rows.get(y) ?? [], card])
          }
          for (const row of rows.values()) {
            const heights = row.map(card => card.getBoundingClientRect().height)
            const max = Math.max(...heights), min = Math.min(...heights)
            if (row.length > 1 && max - min <= 48) for (const card of row) card.style.minHeight = `${max}px`
          }
        })
      }
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
        const next = parent.getBoundingClientRect().width
        if (next !== width) { width = next; measure() }
      })
      observer?.observe(parent)
      const Observer = parent.ownerDocument.defaultView?.MutationObserver
      const mutations = Observer ? new Observer(measure) : null
      mutations?.observe(parent, { childList: true, subtree: true, characterData: true })
      parent.addEventListener('load', measure, true)
      void document.fonts?.ready.then(measure)
      measure()
      groups.set(parent, { users: 1, release: () => {
        observer?.disconnect(); mutations?.disconnect(); view.cancelAnimationFrame(frame)
        parent.removeEventListener('load', measure, true)
        for (const [card, style] of originals) card.style.cssText = style
      } })
    }
    return () => {
      const group = groups.get(parent)
      if (group && --group.users === 0) { group.release(); groups.delete(parent) }
    }
  }, [])
  return ref
}
