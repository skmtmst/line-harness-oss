'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { FOLDER_SELECT_COLORS } from '@line-crm/shared'
import MenuPortal from './menu-portal'
import { isImeComposing } from './ime'
import styles from './folder-color-button.module.css'

export type FolderColorOption = { value: string; name: string }

/** IjVpM・iBuZH 共通：今の色の丸＋矢印。色なしは薄い灰の丸。 */
export default function FolderColorButton({ value, onChange, colors = FOLDER_SELECT_COLORS, disabled = false, compact = false, allowClear = false }: {
  value: string | null
  onChange: (color: string | null) => void
  colors?: ReadonlyArray<FolderColorOption>
  disabled?: boolean
  compact?: boolean
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const paletteId = useId()
  const choices = allowClear ? [{ value: '', name: '色なし' }, ...colors] : colors
  const current = value ?? ''
  const selected = (item: FolderColorOption) => item.value.toLowerCase() === current.toLowerCase()
  const colorName = choices.find(selected)?.name ?? (value || '色なし')
  const close = () => { setOpen(false); buttonRef.current?.focus() }

  useEffect(() => {
    if (!open) return
    paletteRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    // 外から読んだ色が候補にないときも、キーボードで選べる。
    if (!paletteRef.current?.contains(document.activeElement)) paletteRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open])

  useEffect(() => {
    if (!open || !compact) return
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, compact])

  const escape = (event: KeyboardEvent) => {
    if (!open || event.key !== 'Escape') return
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    if (isImeComposing(event)) return
    event.preventDefault()
    close()
  }
  const palette = (
    <div ref={paletteRef} id={paletteId} className={styles.palette} role="radiogroup" aria-label="フォルダの色" onKeyDown={escape}>
      {choices.map((item, index) => (
        <button key={item.value} type="button" role="radio"
          aria-label={item.name} title={item.name} aria-checked={selected(item)}
          tabIndex={selected(item) || (!choices.some(selected) && index === 0) ? 0 : -1}
          disabled={disabled} className={styles.swatch} data-selected={selected(item) || undefined}
          style={item.value ? { backgroundColor: item.value } : undefined}
          onClick={() => { onChange(item.value || null); close() }}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return
            if (event.key === 'Tab') { close(); return }
            if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault(); event.stopPropagation()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length
            onChange(choices[next].value || null)
            paletteRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
          }}
        />
      ))}
    </div>
  )
  return (
    <span ref={rootRef} className={styles.root} onKeyDown={escape} data-folder-color-button="" data-compact={compact || undefined}>
      <button ref={buttonRef} type="button" className={styles.button}
        aria-label={`フォルダの色：${colorName}`} aria-expanded={open}
        aria-controls={open ? paletteId : undefined} aria-haspopup="true" disabled={disabled}
        onClick={() => setOpen((currentOpen) => !currentOpen)}>
        <span className={styles.dot} style={value ? { backgroundColor: value } : undefined} aria-hidden="true" />
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {compact ? (open ? <span className={styles.inlinePalette}>{palette}</span> : null) : (
        <MenuPortal open={open} getAnchor={() => buttonRef.current} onClose={() => setOpen(false)} onEscape={close}>{palette}</MenuPortal>
      )}
    </span>
  )
}
