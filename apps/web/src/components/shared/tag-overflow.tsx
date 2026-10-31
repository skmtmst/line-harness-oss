'use client'

import { Children, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Dialog from './dialog'
import TooltipBubble from './tooltip-bubble'
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
  const measuredContent = useRef('')
  const refreshWidths = useRef<() => void>(() => {})
  const [fit, setFit] = useState(() => ({ count: Math.min(items.length, maxVisible ?? items.length, 1), firstTruncated: false }))
  const lastFit = useRef(fit)
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const [tip, setTip] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const showTip = (el: HTMLButtonElement) => {
    const r = el.getBoundingClientRect()
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--polish-tooltip-gap')) || 8
    setTip({ left: Math.max(gap, Math.min(r.left, innerWidth - 288 - gap)), top: r.bottom + gap, below: true })
  }
  const names = (node: ReactNode): string => Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ name?: string; children?: ReactNode }>(child) ? child.props.name ?? names(child.props.children) : ''
  }).filter(Boolean).join('、')
  useLayoutEffect(() => {
    const host = root.current
    const samples = measure.current
    if (!host || !samples) return
    let active = true
    let widths: number[] | null = null
    let sampleWidth: number | null = null
    measuredContent.current = samples.innerHTML
    const key = {}
    const read = () => {
      if (!active) return () => {}
      // Only the host's available width changes when a column is resized.
      // Keep natural tag widths until their contents, sizing or fonts change.
      if (!widths) {
        widths = Array.from(samples.children).map((child) => child.getBoundingClientRect().width)
        sampleWidth = samples.getBoundingClientRect().width
      }
      const style = getComputedStyle(host)
      // The one-tag layout uses a smaller display gap; fit against the shared natural gap.
      const naturalGap = parseFloat(style.getPropertyValue('--tpl-tag-overflow-gap'))
      const gap = Number.isFinite(naturalGap) ? naturalGap : parseFloat(style.columnGap) || 0
      const available = host.clientWidth
      const count = fittingTagCount(widths, available, gap, () => more.current?.getBoundingClientRect().width ?? 0)
      // 先頭は省略しても残す。全件を隠す明示的な上限と、非表示の器は従来どおり扱う。
      const fitted = Math.min(available > 0 ? Math.max(count, 1) : count, maxVisible ?? items.length)
      const firstTruncated = available > 0 && fitted === 1 && widths[0] + (items.length > 1 ? gap + (more.current?.getBoundingClientRect().width ?? 0) : 0) > available
      return () => {
        if (active && (lastFit.current.count !== fitted || lastFit.current.firstTruncated !== firstTruncated)) {
          const next = { count: fitted, firstTruncated }
          lastFit.current = next
          setFit(next)
        }
      }
    }
    const update = () => { if (active) scheduleMeasurement(key, read) }
    const invalidate = () => { widths = null; update() }
    refreshWidths.current = invalidate
    update()
    const stopObserving = observeElementResize([host, samples], (entries) => {
      if (!entries.length || entries.some((entry) => {
        if (entry.target !== samples) return false
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect?.width
        return width === undefined || width !== sampleWidth
      })) widths = null
      update()
    })
    const fonts = document.fonts
    if (fonts?.status === 'loading') void fonts.ready.then(invalidate)
    fonts?.addEventListener('loadingdone', invalidate)
    return () => { active = false; refreshWidths.current = () => {}; cancelMeasurement(key); stopObserving(); fonts?.removeEventListener('loadingdone', invalidate) }
  }, [maxVisible, items.length])
  useLayoutEffect(() => {
    const content = measure.current?.innerHTML ?? ''
    if (content !== measuredContent.current) { measuredContent.current = content; refreshWidths.current() }
  }, [children])
  const shown = Math.min(fit.count, maxVisible ?? items.length, items.length)
  const rest = items.length - shown
  if (items.length === 0) return null
  return <>
    <span ref={root} className={styles.line} data-tag-overflow="" data-tag-overflow-max={maxVisible} data-tag-overflow-first={fit.firstTruncated && shown === 1 || undefined} onClick={(event) => event.stopPropagation()}>
      <TruncatedTextFocus.Provider value={rest === 0}>{items.slice(0, shown).map((item, index) => <span key={index} className={styles.item} title={index === 0 && fit.firstTruncated ? names(item) || undefined : undefined}>{item}</span>)}</TruncatedTextFocus.Provider>
      {rest > 0 ? <button type="button" className={styles.more} aria-label={`${label}（ほか${rest}件）`} aria-haspopup="dialog" aria-expanded={open} aria-describedby={tip ? tipId : undefined} onMouseEnter={event => showTip(event.currentTarget)} onMouseLeave={() => setTip(null)} onFocus={event => showTip(event.currentTarget)} onBlur={() => setTip(null)} onKeyDown={event => { if (event.key === 'Escape') setTip(null) }} onClick={() => { setTip(null); setOpen(true) }}>+{rest}</button> : null}
      <span ref={measure} className={styles.measure} data-tag-overflow-measure="" aria-hidden="true" inert>{items.map((item, index) => <span key={index} className={styles.item}>{item}</span>)}</span>
      <button ref={more} type="button" className={`${styles.more} ${styles.sampleMore}`} aria-hidden="true" tabIndex={-1} inert>+{items.length}</button>
    </span>
    {tip ? <TooltipBubble id={tipId} text={names(children)} {...tip} /> : null}
    <Dialog open={open} title={label} onCancel={() => setOpen(false)}>
      <div className={styles.all} data-tag-overflow-all="">{items}</div>
    </Dialog>
  </>
}
