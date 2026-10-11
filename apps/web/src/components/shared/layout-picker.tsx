'use client'

import { useId, useRef, type KeyboardEvent } from 'react'
import styles from './layout-picker.module.css'
import RadioCard from './radio-card'

/** 見本も保存する面と同じ順・座標で描く。座標は百分率。 */
export interface LayoutPickerArea {
  label: string
  x: number
  y: number
  width: number
  height: number
}
export interface LayoutPickerOption {
  value: string
  label: string
  areas: LayoutPickerArea[]
}

/** 案A：形のタイル＋面の文字。店・統括・リッチメッセージで共用する。 */
export default function LayoutPicker({ options, value, onChange, disabled = false, preview = 'menu', label = '面の分け方' }: {
  options: LayoutPickerOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  preview?: 'menu' | 'compact-menu' | 'message'
  label?: string
}) {
  const name = useId()
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const selected = Math.max(0, options.findIndex((option) => option.value === value))
  const move = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (disabled) return
    let next: number
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': next = (index + 1) % options.length; break
      case 'ArrowLeft': case 'ArrowUp': next = (index + options.length - 1) % options.length; break
      case 'Home': next = 0; break
      case 'End': next = options.length - 1; break
      default: return
    }
    event.preventDefault()
    inputs.current[next]?.focus()
    onChange(options[next].value)
  }
  return <div className={styles.list} role="radiogroup" aria-label={label} data-preview={preview}>
    {options.map((option, index) => <RadioCard key={option.value} className={styles.tile}
      name={name} value={option.value} checked={option.value === value} disabled={disabled}
      title={option.label} variant="compact" onChange={onChange}
      inputRef={(input) => { inputs.current[index] = input }}
      tabIndex={index === selected ? 0 : -1}
      ariaLabel={`${option.label}（面 ${option.areas.map((area) => area.label).join('・')}）`}
      onKeyDown={(event) => move(event, index)}>
      <span className={styles.sample} aria-hidden="true">
        {option.areas.map((area) => <span key={area.label} className={styles.area} style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.width}%`, height: `${area.height}%` }}>{area.label}</span>)}
      </span>
    </RadioCard>)}
  </div>
}
