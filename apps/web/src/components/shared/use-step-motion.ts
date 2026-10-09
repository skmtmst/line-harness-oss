'use client'

import { useLayoutEffect, useRef } from 'react'
import { motionMs, shouldAnimateLeave } from './overlay-utils'

/** 本文だけを入れ替える。窓・入力のstate・焦点を作り直さない。 */
export function useStepMotion(enabled: boolean, stepKey: unknown) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const heightRef = useRef<number | null>(null)
  const stepRef = useRef(stepKey)
  const heightAnimationRef = useRef<Animation | null>(null)
  const fadeRef = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    if (!enabled) return
    const outer = outerRef.current, inner = innerRef.current
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const css = getComputedStyle(outer)
      const next = inner.getBoundingClientRect().height + (parseFloat(css.paddingTop) || 0) + (parseFloat(css.paddingBottom) || 0)
      const previous = heightRef.current
      heightRef.current = next
      if (previous === null || Math.abs(next - previous) < 1) return
      const from = heightAnimationRef.current ? outer.getBoundingClientRect().height : previous
      heightAnimationRef.current?.cancel()
      if (!shouldAnimateLeave() || typeof outer.animate !== 'function') return
      heightAnimationRef.current = outer.animate([{ height: `${from}px` }, { height: `${next}px` }], { duration: motionMs('--motion-base', 200), easing: 'cubic-bezier(0.2, 0, 0, 1)' })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => { observer.disconnect(); heightAnimationRef.current?.cancel(); heightRef.current = null }
  }, [enabled])
  useLayoutEffect(() => {
    if (stepRef.current === stepKey) return
    stepRef.current = stepKey
    fadeRef.current?.cancel()
    if (!enabled || !shouldAnimateLeave() || !innerRef.current?.animate) return
    fadeRef.current = innerRef.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMs('--motion-exit', 150), easing: 'ease-out' })
  }, [enabled, stepKey])
  useLayoutEffect(() => () => fadeRef.current?.cancel(), [])
  return { outerRef, innerRef }
}
