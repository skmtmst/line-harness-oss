'use client'

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import styles from './scrollable-table.module.css'
import { scrollToThumb, thumbToScroll } from './scrollable-table-position'

/** TBCUY: 情報を省けない表に限り、最初の列を残して横に送る。 */
export default function ScrollableTable({ children, frozen, label, height = 318, frozenWidth = 288, initialScroll = 0 }: {
  children: ReactNode
  frozen?: ReactNode
  label: string
  height?: number
  frozenWidth?: number
  initialScroll?: number
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [maximum, setMaximum] = useState(0)
  const [trackWidth, setTrackWidth] = useState(0)
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const refresh = () => { setMaximum(Math.max(0, el.scrollWidth - el.clientWidth)); setTrackWidth(track.current?.clientWidth ?? 0); setScroll(el.scrollLeft) }
    const resize = new ResizeObserver(refresh)
    resize.observe(el); if (el.firstElementChild) resize.observe(el.firstElementChild)
    refresh(); el.scrollLeft = initialScroll; setScroll(el.scrollLeft)
    return () => resize.disconnect()
  }, [initialScroll])
  const thumbWidth = Math.min(trackWidth, Math.max(360, trackWidth * (viewport.current?.clientWidth ?? 0) / ((viewport.current?.scrollWidth ?? 0) || 1)))
  const travel = Math.max(0, trackWidth - thumbWidth)
  const thumbLeft = scrollToThumb(scroll, maximum, travel)
  const move = (value: number) => { if (viewport.current) viewport.current.scrollLeft = Math.max(0, Math.min(maximum, value)) }
  return (
    <div className={styles.frame} data-has-more={scroll < maximum || undefined} style={{ height, '--frozen-width': `${frozen ? frozenWidth : 0}px` } as CSSProperties}>
      <div ref={viewport} className={styles.viewport} role="region" aria-label={label} tabIndex={0} data-scroll-x onScroll={e => setScroll(e.currentTarget.scrollLeft)}>
        {children}
      </div>
      {frozen ? <div className={styles.frozen}>{frozen}</div> : null}
      <div ref={track} className={styles.track} onPointerDown={e => {
        if (!maximum || !travel) return
        const rect = e.currentTarget.getBoundingClientRect()
        const startX = e.clientX
        const startLeft = e.target === e.currentTarget ? Math.max(0, Math.min(travel, startX - rect.left - thumbWidth / 2)) : thumbLeft
        e.currentTarget.setPointerCapture(e.pointerId)
        if (e.target === e.currentTarget) move(thumbToScroll(startLeft, maximum, travel))
        const target = e.currentTarget
        const drag = (event: PointerEvent) => move(thumbToScroll(startLeft + event.clientX - startX, maximum, travel))
        const stop = () => { target.removeEventListener('pointermove', drag); target.removeEventListener('pointerup', stop); target.removeEventListener('pointercancel', stop) }
        target.addEventListener('pointermove', drag); target.addEventListener('pointerup', stop); target.addEventListener('pointercancel', stop)
      }}>
        <div className={styles.thumb} role="slider" aria-orientation="horizontal" tabIndex={maximum ? 0 : -1} aria-label={`${label}の横送り`} aria-valuemin={0} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(scroll)} style={{ width: thumbWidth, left: thumbLeft }} onKeyDown={e => {
          const steps: Record<string, number> = { ArrowLeft: scroll - 50, ArrowRight: scroll + 50, Home: 0, End: maximum }
          if (e.key in steps) { e.preventDefault(); move(steps[e.key]) }
        }} />
      </div>
    </div>
  )
}
