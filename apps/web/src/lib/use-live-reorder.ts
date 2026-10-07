'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

/*
 * 並べ替えの「付いてくる動き」（フルード・インタラクション ②）。
 *
 * つまみで行を動かしている間、動かしている行はマウスに付いてくる（ブラウザの引きずりの影）。
 * 置き場所は持っている行の上を通るたびに入れ替えて見せ、ほかの行は滑らかに場所を空ける
 * （useFlipRows）。離したら、その見せていた位置へ置く。保存の仕方は画面のまま
 * （画面の dropOn(置く先の行) をそのまま呼ぶ）。
 */
export function useLiveReorder<T>(items: readonly T[], idOf: (item: T) => string, dragId: string | null) {
  const [overId, setOverId] = useState<string | null>(null)
  useEffect(() => { if (!dragId) setOverId(null) }, [dragId])
  const shown = useMemo(() => {
    if (!dragId || !overId || dragId === overId) return items
    const from = items.findIndex((item) => idOf(item) === dragId)
    const to = items.findIndex((item) => idOf(item) === overId)
    if (from < 0 || to < 0) return items
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
    // idOf は毎回作り直されても同じ意味。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, dragId, overId])
  /** 行が引きずりの下に来た。自分（動かしている行）の上は無視する（行がずれて往復しない）。 */
  const enter = useCallback((id: string) => {
    if (!dragId || id === dragId) return
    setOverId(id)
  }, [dragId])
  /** 離したときに置く先。入れ替えて見せていた位置の行。 */
  const dropTarget = useCallback((fallback: string) => overId ?? fallback, [overId])
  const reset = useCallback(() => setOverId(null), [])
  return { shown, overId, enter, dropTarget, reset }
}

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 並びが変わったとき、各行を前の位置から今の位置へ滑らせる（FLIP）。
 * 行には `data-reorder-id` を付ける。動きを減らす設定では動かさない。長さは --motion-base。
 */
export function useFlipRows(containerRef: RefObject<HTMLElement | null>, orderKey: string): void {
  const positions = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const rows = [...container.querySelectorAll<HTMLElement>('[data-reorder-id]')]
    const next = new Map<string, number>()
    const animate = !reducedMotion() && typeof HTMLElement.prototype.animate === 'function'
    const duration = animate
      ? Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-base')) || 0
      : 0
    for (const row of rows) {
      const id = row.dataset.reorderId ?? ''
      const top = row.getBoundingClientRect().top
      next.set(id, top)
      const before = positions.current.get(id)
      if (!animate || before === undefined || duration <= 0) continue
      const delta = before - top
      if (Math.abs(delta) < 1) continue
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
    }
    positions.current = next
  }, [containerRef, orderKey])
}
