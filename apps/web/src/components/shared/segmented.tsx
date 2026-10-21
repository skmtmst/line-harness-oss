'use client'
import { cancelMeasurement, scheduleMeasurement } from './dom-measurement-batch'
import { observeElementResize } from './element-resize-observer'

import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import styles from './segmented.module.css'
import { useFieldContext } from './field-context'

/**
 * 切り替え（3つ）（Pencil ★V8 `dtJVi`）。
 *
 * 灰色（shell）の器の中に項目を並べ、選んだものへ白いつまみが
 * 前の位置から滑って着く（120ms）。左右の矢印キーでも移せる。
 * 「期間：7日/30日/90日」や「表示：表/カード」など、2〜4つの
 * 排他的な切り替えに使う。
 */
export default function SegmentedControl<T extends string>({
  id,
  invalid,
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
  size = 'medium',
  disabled = false,
  appearance = 'track',
  equalWidth = false,
  fit,
}: {
  id?: string
  invalid?: boolean
  options: { value: T; label: ReactNode; ariaLabel?: string; count?: number }[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  className?: string
  /**
   * 'timing' は連動タイミングの高さ40・幅360の2択。
   * 大きさ。既定 'medium' は箱型（dtJVi：項目 6/12・文 13）。
   * 'small' は小型（d8X09 グラフ／表：器 r8・項目 3/10・文 12・
   * つまみ r6・全体の高さ 28）。'compact' は詰めた形（ベルの小窓 mV28V：
   * 器 r10・項目 4/12・文 12/18・つまみ r8・全体の高さ 30）。
   * 'panel' は脇のパネル内（★BG-B `SLgY5` つくる枚数：器 余白3・r8・
   * 横いっぱい・項目 5/12・文 12/17・選択中 700・つまみ r6）。v8 だけで効く。
   */
  size?: 'medium' | 'small' | 'compact' | 'panel' | 'timing' | 'sticker' | 'booking'
  /** 操作を止める（生成中など）。項目すべてを押せなくする。 */
  disabled?: boolean
  /**
   * 電話予約の探し方：各項目が独立した丸い選択肢。
   * 'intake-stop' はデリバリー受注の受付一括停止（XCVGd `To5Y0`）：
   * 高さ32・左右14・間8の離れた札4つで、選んだ札だけ薄い緑の面と緑の枠。
   */
  appearance?: 'track' | 'choices' | 'reservation' | 'intake-stop'
  /** 選択肢を器の幅へ均等に並べる（統括の生成枚数）。 */
  equalWidth?: boolean
  /** 文字の幅へ器を収める。縦の入力・カードで横いっぱいに伸ばさない。 */
  fit?: 'content'
}) {
  const field = useFieldContext()
  const bad = invalid || field?.invalid
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [thumb, setThumb] = useState({ left: 0, width: 0 })

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))

  const thumbRef = useRef(thumb)
  const queueMeasure = useRef<() => void>(() => {})
  const optionKeys = JSON.stringify(options.map(option => option.value))

  // Observe option geometry as well as the root: labels/counts can change at fixed root width.
  useLayoutEffect(() => {
    if (appearance !== 'track') return
    let active = true
    const key = {}
    const read = () => {
      const item = itemRefs.current[selectedIndex]
      if (!active || !item) return () => {}
      const next = { left: item.offsetLeft, width: item.offsetWidth }
      return () => {
        if (!active || (thumbRef.current.left === next.left && thumbRef.current.width === next.width)) return
        thumbRef.current = next
        setThumb(next)
      }
    }
    const update = () => { if (active) scheduleMeasurement(key, read) }
    queueMeasure.current = update
    update()
    const stopObserving = observeElementResize([rootRef.current, ...itemRefs.current].filter((node): node is HTMLDivElement | HTMLButtonElement => node !== null), update)
    const fonts = document.fonts
    void fonts?.ready.then(update)
    fonts?.addEventListener?.('loadingdone', update)
    return () => {
      active = false
      if (queueMeasure.current === update) queueMeasure.current = () => {}
      cancelMeasurement(key)
      stopObserving()
      fonts?.removeEventListener?.('loadingdone', update)
    }
  }, [selectedIndex, optionKeys, appearance])

  // New labels/counts or presentation changes queue a read, without rebuilding observers.
  useLayoutEffect(() => { queueMeasure.current() }, [options, selectedIndex, appearance, size, className, disabled, equalWidth, fit, bad])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = (selectedIndex + delta + options.length) % options.length
    onChange(options[next].value)
    itemRefs.current[next]?.focus()
  }

  return (
    <div
      data-segmented-control
      ref={rootRef}
      id={id ?? field?.controlId}
      data-invalid={bad || undefined}
      aria-describedby={field?.describedBy}
      style={bad ? { outline: '1px solid var(--color-danger)' } : undefined}
      role="group"
      aria-label={ariaLabel}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-size={size}
      data-appearance={appearance}
      data-equal-width={equalWidth || undefined}
      data-segmented-fit={fit}
      onKeyDown={onKeyDown}
    >
      {appearance === 'track' ? <span
        className={styles.thumb}
        style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        aria-hidden="true"
      /> : null}
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            itemRefs.current[index] = el
          }}
          type="button"
          disabled={disabled}
          className={[styles.item, option.value === value ? styles.selected : null]
            .filter(Boolean)
            .join(' ')}
          aria-label={option.ariaLabel}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}{option.count !== undefined ? <span className={styles.count}>{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}
