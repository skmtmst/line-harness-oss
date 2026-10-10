'use client'

import { useLayoutEffect, useRef, type RefObject } from 'react'
import { motionMs, shouldAnimateLeave } from './overlay-utils'

/** 通知の位置だけを詰める。閉じるフェードとは別の箱を動かす。 */
export function useStackMotion(container: RefObject<HTMLDivElement | null>, version: unknown) {
  const positions = useRef(new Map<string, number>())
  const animations = useRef(new Map<string, Animation>())
  useLayoutEffect(() => {
    const next = new Map<string, number>()
    const elements = container.current?.querySelectorAll<HTMLElement>('[data-stack-item]') ?? []
    for (const element of elements) {
      const id = element.dataset.stackItem!
      const rect = element.getBoundingClientRect()
      const transform = getComputedStyle(element).transform
      const offset = transform?.startsWith('matrix(') ? Number(transform.slice(7, -1).split(',')[5]) || 0 : 0
      const top = rect.top - offset
      next.set(id, top)
      const before = positions.current.get(id)
      animations.current.get(id)?.cancel()
      animations.current.delete(id)
      if (before === undefined || Math.abs(before + offset - top) < 1 || !shouldAnimateLeave() || !element.animate) continue
      const animation = element.animate([{ transform: `translateY(${before + offset - top}px)` }, { transform: 'translateY(0)' }], { duration: motionMs('--motion-base', 200), easing: 'cubic-bezier(0.2, 0, 0, 1)' })
      animations.current.set(id, animation)
    }
    for (const [id, animation] of animations.current) if (!next.has(id)) { animation.cancel(); animations.current.delete(id) }
    positions.current = next
  }, [container, version])
  useLayoutEffect(() => () => { for (const animation of animations.current.values()) animation.cancel() }, [])
}
