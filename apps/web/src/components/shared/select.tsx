'use client'

import { ArrowUpDown, Check, ChevronDown, ChevronUp } from 'lucide-react'
import React, { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import MenuPortal from './menu-portal'
import styles from './select.module.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  'aria-label': string
  className?: string
  defaultOpen?: boolean
  disabled?: boolean
  error?: string
  id?: string
  label?: string
  name?: string
  onChange: (value: string) => void
  options: SelectOption[]
  size?: 'standard' | 'page-size' | 'full'
  value: string
  /**
   * 箱の幅（px）。渡すと size の幅を上書きする
   * （x6QsVz の絞り込み欄 122〜136 など板ごとの絵幅）。
   */
  width?: number
  /**
   * 見せ方。既定 'box' は枠の箱。'text' は枠なし文字＋上下矢印
   * （x6QsVz の並び替えどおり）。v8 だけで枠を消す。
   */
  treatment?: 'box' | 'text'
}

/** Pencil V5 `rpot9` / `Gfsb4` を正本にした単一選択。 */
export default function Select({
  'aria-label': ariaLabel,
  className,
  defaultOpen = false,
  disabled = false,
  error,
  id,
  label,
  name,
  onChange,
  options,
  size = 'standard',
  value,
  width,
  treatment = 'box',
}: SelectProps) {
  const generatedId = useId()
  const buttonId = id ?? `${generatedId}-button`
  const listboxId = `${generatedId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  const enabledOptions = options.filter((option) => !option.disabled)
  const selectedIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === value))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    setActiveIndex(selectedIndex)
  }, [selectedIndex])

  const choose = (option: SelectOption) => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  const move = (direction: 1 | -1) => {
    if (enabledOptions.length === 0) return
    setActiveIndex((current) => (current + direction + enabledOptions.length) % enabledOptions.length)
  }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open && enabledOptions[activeIndex]) choose(enabledOptions[activeIndex])
      else setOpen(true)
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={[
        styles.root,
        styles[size === 'page-size' ? 'pageSize' : size],
        open ? styles.open : null,
        disabled ? styles.disabled : null,
        error ? styles.invalid : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
      data-design-node={open ? 'Gfsb4' : size === 'page-size' ? 'niGPF' : 'rpot9'}
    >
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <button
        ref={triggerRef}
        id={buttonId}
        type="button"
        className={`${styles.trigger} ${open ? styles.openTrigger : styles.closedTrigger} ${treatment === 'text' ? styles.textTrigger : ''}`}
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={Boolean(error) || undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
      >
        {treatment === 'text' ? (
          <ArrowUpDown className={styles.directionIcon} aria-hidden="true" />
        ) : null}
        {/* 省略表示（…）のとき、ホバーで全文を確認できる（#640）。 */}
        <span className={styles.value} title={selected?.label ?? undefined}>
          {label ? `${label}：` : ''}{selected?.label ?? ''}
        </span>
        {open ? (
          <ChevronUp className={styles.chevron} aria-hidden="true" />
        ) : (
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <MenuPortal
          open={open}
          align="start"
          matchWidth
          getAnchor={() => triggerRef.current}
          onClose={() => setOpen(false)}
        >
          <ul
            id={listboxId}
            role="listbox"
            aria-labelledby={buttonId}
            className={styles.listbox}
            // 最上層では absolute 指定を無効にする（位置は器が決める）。
            // 欄に焦点を残したまま押せるよう、押す前に焦点を移さない。
            style={{ position: 'static', width: '100%' }}
            onMouseDown={(event) => event.preventDefault()}
          >
          {options.map((option) => {
            const optionIndex = enabledOptions.findIndex((candidate) => candidate.value === option.value)
            const isSelected = option.value === value
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  className={`${styles.option} ${isSelected ? `${styles.selected} ${styles.selectedBackground}` : ''}`}
                  disabled={option.disabled}
                  data-active={optionIndex === activeIndex || undefined}
                  onMouseEnter={() => {
                    if (optionIndex >= 0) setActiveIndex(optionIndex)
                  }}
                  onClick={() => choose(option)}
                >
                  <span className={`${styles.check} ${isSelected ? styles.checked : ''}`}>
                    {isSelected ? <Check className={styles.checkIcon} aria-hidden="true" /> : null}
                  </span>
                  <span>{option.label}</span>
                </button>
              </li>
            )
          })}
          </ul>
        </MenuPortal>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  )
}
