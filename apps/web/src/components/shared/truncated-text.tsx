'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HTMLAttributes } from 'react'
import styles from './truncated-text.module.css'

/** URLの行き先を残して、間の階層だけを省略する。リンク先・コピーする値は変えない。 */
export function compactUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return value
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2 && !url.search && !url.hash) return value
    return `${url.protocol}//${url.host}/…/${parts.at(-1) ?? ''}`
  } catch { return value }
}

/** 一行の省略と全文の吹き出し。短い文字には余分なTab停止を作らない。 */
export default function TruncatedText({ value, url = false, className, ...props }: Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'title'> & { value: string; url?: boolean }) {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [clipped, setClipped] = useState(false)
  const [nested, setNested] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const shown = url ? compactUrl(value) : value
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current) }, [])
  const close = useCallback(() => { clear(); setPosition(null) }, [clear])
  const open = useCallback(() => {
    clear()
    const node = ref.current
    if (!node || (!clipped && shown === value && node.scrollWidth <= node.clientWidth)) return
    const rect = node.getBoundingClientRect()
    const css = getComputedStyle(document.documentElement)
    const edge = Number.parseFloat(css.getPropertyValue('--polish-space-row')) || 8
    const width = Number.parseFloat(css.getPropertyValue('--polish-tooltip-width')) || 288
    const gap = Number.parseFloat(css.getPropertyValue('--polish-tooltip-gap')) || 8
    const below = rect.top < width / 2
    setPosition({ left: Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)), top: below ? rect.bottom + gap : rect.top - gap, below })
  }, [clear, clipped, shown, value])
  const leave = () => { clear(); timer.current = setTimeout(close, 120) }
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setClipped(node.scrollWidth > node.clientWidth || shown !== value)
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(node)
    const parent = node.closest('a, button, [role="button"], [role="tab"]')
    setNested(Boolean(parent))
    parent?.addEventListener('focus', open)
    parent?.addEventListener('blur', close)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); parent?.removeEventListener('focus', open); parent?.removeEventListener('blur', close); window.removeEventListener('resize', update); clear() }
  }, [shown, value, open, close, clear])
  useEffect(() => {
    if (!position) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', escape)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { document.removeEventListener('keydown', escape); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [position, close])
  return <>
    <span {...props} ref={ref} className={[styles.text, className].filter(Boolean).join(' ')} data-truncated-text="" tabIndex={nested ? undefined : clipped ? 0 : undefined} aria-describedby={position ? id : undefined} aria-label={shown !== value ? value : props['aria-label']} onMouseEnter={open} onMouseLeave={leave} onFocus={open} onBlur={close}>{shown}</span>
    {position ? createPortal(<span id={id} role="tooltip" className={styles.tooltip} data-below={position.below} style={{ left: position.left, top: position.top }} onMouseEnter={clear} onMouseLeave={leave}>{value}</span>, document.body) : null}
  </>
}
