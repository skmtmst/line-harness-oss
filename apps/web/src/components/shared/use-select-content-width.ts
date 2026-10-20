import { useLayoutEffect, type RefObject } from 'react'
import { fitSelectContent } from './select-content-size.mjs'
import type { SelectProps } from './select-types'

type ContentWidthOptions = Pick<SelectProps, 'size' | 'label' | 'treatment' | 'showChevron' | 'iconOnly' | 'icon'> & { selectedLabel?: string }

export function useSelectContentWidth(rootRef: RefObject<HTMLDivElement | null>, { size, selectedLabel, label, treatment, showChevron, iconOnly, icon }: ContentWidthOptions) {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (size !== 'content' || !root || iconOnly) return
    let active = true
    const measure = () => { if (active) fitSelectContent(root) }
    let frame = 0
    const queue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queue)
    observer?.observe(root)
    measure()
    void document.fonts?.ready.then(measure)
    return () => { active = false; cancelAnimationFrame(frame); observer?.disconnect(); root.style.removeProperty('--list-select-content-width') }
  }, [rootRef, size, selectedLabel, label, treatment, showChevron, iconOnly, icon])
}
