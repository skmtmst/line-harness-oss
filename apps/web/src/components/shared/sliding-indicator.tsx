'use client'

import { useLayoutEffect, useRef } from 'react'
import { motionMs, shouldAnimateLeave } from './overlay-utils'

/** 選択位置の共通FLIP。幅は一度だけ更新し、途中の見かけの位置から次へ進む。 */
export function SlidingIndicator({ left, top = 0, width, selection, className }: {
  left: number; top?: number; width: number; selection: string | number; className: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef<{ selection: string | number; width: number } | null>(null)
  const animation = useRef<Animation | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const old = previous.current
    const moving = old && old.width > 0 && width > 0 && old.selection !== selection
      && shouldAnimateLeave() && typeof element.animate === 'function'
    // 書き換える前に、進行中の動きも含む現在の矩形を読む。
    const box = moving ? element.getBoundingClientRect() : null
    const parent = moving ? element.parentElement?.getBoundingClientRect() : null
    animation.current?.cancel()
    animation.current = null
    element.style.width = `${width}px`
    const target = top === 0 ? `translateX(${left}px)` : `translate(${left}px, ${top}px)`
    element.style.transform = target
    previous.current = { selection, width }
    if (box && parent && box.width > 0) {
      const x = box.left - parent.left + (element.parentElement?.scrollLeft ?? 0)
      // 下線はbottom:0を基準にし、折り返したタブの段にも追従する。
      const y = box.top - parent.top - element.offsetTop + (element.parentElement?.scrollTop ?? 0)
      const start = Number.isFinite(y) && y !== 0 ? `translate(${x}px, ${y}px)` : `translateX(${x}px)`
      const easing = getComputedStyle(document.documentElement).getPropertyValue('--motion-ease-out').trim() || 'ease-out'
      animation.current = element.animate([
        { transform: `${start} scaleX(${box.width / width})` },
        { transform: `${target} scaleX(1)` },
      ], { duration: motionMs('--motion-base', 200), easing })
    }
  }, [left, top, width, selection])

  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const stop = () => { if (media?.matches) animation.current?.cancel() }
    media?.addEventListener?.('change', stop)
    return () => {
      animation.current?.cancel()
      media?.removeEventListener?.('change', stop)
    }
  }, [])

  return <span ref={ref} className={className} aria-hidden="true" hidden={width <= 0} />
}
