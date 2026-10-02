'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pipette } from 'lucide-react'
import styles from './color-well.module.css'

/** よく使う色の見本（8×3）。macOS カラーウェルの格子に倣う。 */
const DEFAULT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#16a34a', '#06c755',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#64748b', '#1d1d1f', '#ffffff', '#9ca3af', '#d1d5db', '#f5f5f7',
]

const HEX = /^#?[0-9a-fA-F]{6}$/

/**
 * 色を選ぶ（Pencil ★V8 `KVkPg`／開いた状態 `mpJVS`。手本は macOS のカラーウェル）。
 *
 * 今の色の見本＋区切り線＋開く矢印の 36px のコントロール。押すと下に
 * 色の格子（8×3）・スポイト（対応ブラウザのみ）・十六進を直に入れる欄が
 * 開く。Esc・外側を押す・色を選ぶで閉じる。
 */
export default function ColorWell({
  value,
  onChange,
  colors = DEFAULT_COLORS,
  label = '色を選ぶ',
  disabled = false,
}: {
  /** 今の色（`#rrggbb`）。 */
  value: string
  onChange: (color: string) => void
  /** 格子に並べる色。渡さないときは DEFAULT_COLORS。 */
  colors?: string[]
  label?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const hasDropper = typeof window !== 'undefined' && 'EyeDropper' in window

  useEffect(() => setHex(value), [value])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const pick = (color: string) => {
    onChange(color)
    setOpen(false)
  }

  const pickWithDropper = async () => {
    try {
      const dropper = new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper()
      const { sRGBHex } = await dropper.open()
      onChange(sRGBHex)
      setOpen(false)
    } catch {
      /* ユーザがキャンセルした */
    }
  }

  return (
    <span ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.well}
        aria-label={`${label}（今の色 ${value}）`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.swatch} style={{ backgroundColor: value }} aria-hidden="true" />
        <span className={styles.divider} aria-hidden="true" />
        <ChevronDown size={14} aria-hidden="true" className={styles.caret} />
      </button>
      {open ? (
        <div className={styles.pop} role="dialog" aria-label={label}>
          <div className={styles.grid} role="listbox" aria-label="よく使う色">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                role="option"
                aria-selected={color.toLowerCase() === value.toLowerCase()}
                aria-label={color}
                className={styles.cell}
                style={{ backgroundColor: color }}
                onClick={() => pick(color)}
              />
            ))}
          </div>
          <div className={styles.row}>
            {hasDropper ? (
              <button type="button" className={styles.dropper} aria-label="画面の色をすくう" onClick={() => void pickWithDropper()}>
                <Pipette size={14} aria-hidden="true" />
              </button>
            ) : null}
            <label className={styles.hexField}>
              <span className={styles.hexMark}>#</span>
              <input
                className={styles.hexInput}
                value={hex.replace(/^#/, '')}
                aria-label="色を十六進で入力"
                onChange={(event) => setHex(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  const next = `#${hex.replace(/^#/, '')}`
                  if (HEX.test(next)) pick(next.toLowerCase())
                }}
                onBlur={() => {
                  const next = `#${hex.replace(/^#/, '')}`
                  if (HEX.test(next) && next.toLowerCase() !== value.toLowerCase()) onChange(next.toLowerCase())
                  else setHex(value)
                }}
              />
            </label>
          </div>
        </div>
      ) : null}
    </span>
  )
}
