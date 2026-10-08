'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import styles from './segmented.module.css'

/**
 * 切り替え（3つ）（Pencil ★V8 `dtJVi`）。
 *
 * 灰色（shell）の器の中に項目を並べ、選んだものへ白いつまみが
 * 前の位置から滑って着く（120ms）。左右の矢印キーでも移せる。
 * 「期間：7日/30日/90日」や「表示：表/カード」など、2〜4つの
 * 排他的な切り替えに使う。
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
  size = 'medium',
  disabled = false,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  className?: string
  /**
   * 'timing' は連動タイミング（gSsPR）の高さ40・幅360の2択。
   * 大きさ。既定 'medium' は箱型（dtJVi：項目 6/12・文 13）。
   * 'small' は小型（d8X09 グラフ／表：器 r8・項目 3/10・文 12・
   * つまみ r6・全体の高さ 28）。'compact' は詰めた形（ベルの小窓 mV28V：
   * 器 r10・項目 4/12・文 12/18・つまみ r8・全体の高さ 30）。
   * 'panel' は脇のパネル内（★BG-B `SLgY5` つくる枚数：器 余白3・r8・
   * 横いっぱい・項目 5/12・文 12/17・選択中 700・つまみ r6）。v8 だけで効く。
   */
  size?: 'medium' | 'small' | 'compact' | 'panel' | 'timing'
  /** 操作を止める（生成中など）。項目すべてを押せなくする。 */
  disabled?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [thumb, setThumb] = useState({ left: 0, width: 0 })

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))

  // 選択中の項目の位置へつまみを合わせる。文字の太さ変化・
  // フォント読み込みで幅が動くので ResizeObserver で追従する。
  useLayoutEffect(() => {
    const measure = () => {
      const item = itemRefs.current[selectedIndex]
      if (item) setThumb({ left: item.offsetLeft, width: item.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (rootRef.current) observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [selectedIndex, options])

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
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-size={size}
      onKeyDown={onKeyDown}
    >
      <span
        className={styles.thumb}
        style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        aria-hidden="true"
      />
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
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
