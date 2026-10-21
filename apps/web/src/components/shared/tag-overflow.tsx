'use client'

import { Children, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Dialog from './dialog'
import { TruncatedTextFocus } from './truncated-text'
import { cancelMeasurement, scheduleMeasurement } from './dom-measurement-batch'
import { observeElementResize } from './element-resize-observer'
import styles from './tag-overflow.module.css'

/** : 横1行に入る数。+N の幅も先に確保する。 */
export function fittingTagCount(widths: number[], available: number, gap: number, moreWidth: (rest: number) => number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap
  if (total <= available) return widths.length
  let used = 0
  for (let count = 0; count < widths.length; count++) {
    const next = used + widths[count] + (count ? gap : 0)
    if (next + gap + moreWidth(widths.length - count - 1) > available) return count
    used = next
  }
  return widths.length
}

/** タグ・条件・状態の札に共通。全件を受け取り、消した分を必ず +N で開ける。 */
export default function TagOverflow({ children, label = 'すべてのタグ', maxVisible }: {
  children: ReactNode
  label?: string
  maxVisible?: number
}) {
  const items = Children.toArray(children)
  const root = useRef<HTMLSpanElement>(null)
  const measure = useRef<HTMLSpanElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [fit, setFit] = useState(0)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const host = root.current
    const samples = measure.current
    if (!host || !samples) return
    let active = true
    let widths: number[] | null = null
    const key = {}
    const read = () => {
      if (!active) return () => {}
      // Only the host's available width changes when a column is resized.
      // Keep natural tag widths until their contents, sizing or fonts change.
      widths ??= Array.from(samples.children).map((child) => child.getBoundingClientRect().width)
      const gap = parseFloat(getComputedStyle(host).columnGap) || 0
      const count = fittingTagCount(widths, host.clientWidth, gap, () => more.current?.getBoundingClientRect().width ?? 0)
      const fitted = Math.min(Math.max(count, widths.length ? 1 : 0), maxVisible ?? items.length)
      // 1つも入らない狭い列でも、最初の札は省略して出す（+N だけにしない。絵 ）。
      return () => { if (active) setFit(fitted) }
    }
    const update = () => { if (active) scheduleMeasurement(key, read) }
    const invalidate = () => { widths = null; update() }
    update()
    const stopObserving = observeElementResize([host, samples], (entries) => {
      if (!entries.length || entries.some((entry) => entry.target === samples)) widths = null
      update()
    })
    const fonts = document.fonts
    if (fonts?.status === 'loading') void fonts.ready.then(invalidate)
    fonts?.addEventListener('loadingdone', invalidate)
    return () => { active = false; cancelMeasurement(key); stopObserving(); fonts?.removeEventListener('loadingdone', invalidate) }
  }, [children, maxVisible, items.length])
  const shown = Math.min(fit, maxVisible ?? items.length, items.length)
  const rest = items.length - shown
  return <>
    <span ref={root} className={styles.line} data-tag-overflow="" onClick={(event) => event.stopPropagation()}>
      <TruncatedTextFocus.Provider value={rest === 0}>{items.slice(0, shown).map((item, index) => <span key={index} className={styles.item} data-shrink={shown === 1 && rest > 0 ? '' : undefined}>{item}</span>)}</TruncatedTextFocus.Provider>
      {rest > 0 ? <button type="button" className={styles.more} aria-label={`${label}（ほか${rest}件）`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>+{rest}</button> : null}
      <span ref={measure} className={styles.measure} data-tag-overflow-measure="" aria-hidden="true" inert>{items.map((item, index) => <span key={index} className={styles.item}>{item}</span>)}</span>
      <button ref={more} type="button" className={`${styles.more} ${styles.sampleMore}`} aria-hidden="true" tabIndex={-1} inert>+{items.length}</button>
    </span>
    <Dialog open={open} title={label} onCancel={() => setOpen(false)}>
      <div className={styles.all} data-tag-overflow-all="">{items}</div>
    </Dialog>
  </>
}
