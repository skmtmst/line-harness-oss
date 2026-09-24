'use client'

import { Plus, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import Checkbox from '@/components/shared/checkbox'
import { OptionMatch } from './combobox'
import type { ComboboxOption } from './combobox'
import styles from './multi-select.module.css'

export type MultiSelectOption = ComboboxOption

export interface MultiSelectProps {
  'aria-label': string
  className?: string
  /** 候補なしのときの「＋ 新しく作る」の文。渡したときだけ出す。 */
  createLabel?: (query: string) => string
  defaultOpen?: boolean
  disabled?: boolean
  /** 候補なしの文。既定は「『○○』に合う候補はありません」。 */
  emptyText?: (query: string) => string
  /** 誤りの文。枠が赤くなり、下に何をすれば通るかを出す。 */
  error?: string
  id?: string
  /** 最初に入れておく絞り込みの文字（見本用）。 */
  initialQuery?: string
  /** 読み込み中は候補の場所を空けたまま「探しています…」を出す。 */
  loading?: boolean
  /** 欄に並べる札の上限。入り切らない分は「+N」。既定は 2。 */
  maxChips?: number
  name?: string
  onChange: (values: string[]) => void
  /** 「＋ 新しく作る」を押したとき。渡したときだけ候補なしの行に出す。 */
  onCreate?: (query: string) => void
  options: MultiSelectOption[]
  placeholder?: string
  values: string[]
}

/**
 * 複数選択。Pencil ★V7 `WUVcz`「候補つき入力・複数選択」§2。
 *
 * 欄・候補の見た目と動きは Combobox（§1）と同じ。
 *
 * - 選んだものは札で並べ、入り切らない分は「+N」。+N を押すと一覧が開く
 * - 開いた一覧の頭に「N件選択中」「すべて外す」。選んでも閉じない
 * - 各行の頭は共通 Checkbox。行自体が option で、印は見た目だけ
 *   （押す・選ぶは行が受けるので、印に焦点は当てない）
 * - 空の欄で Backspace を押すと、最後の札を外す
 * - 件数は role=status で読む。Esc で閉じても打った文字は残す
 */
export default function MultiSelect({
  'aria-label': ariaLabel,
  className,
  createLabel,
  defaultOpen = false,
  disabled = false,
  emptyText,
  error,
  id,
  initialQuery,
  loading = false,
  maxChips = 2,
  name,
  onChange,
  onCreate,
  options,
  placeholder = '選ぶ',
  values,
}: MultiSelectProps) {
  const generatedId = useId()
  const inputId = id ?? `${generatedId}-input`
  const listboxId = `${generatedId}-listbox`
  const errorId = `${generatedId}-error`
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [activeIndex, setActiveIndex] = useState(0)

  const selected = values
    .map((value) => options.find((option) => option.value === value) ?? { value, label: value })
  const visibleChips = selected.slice(0, Math.max(1, maxChips))
  const overflowCount = selected.length - visibleChips.length

  const trimmed = query.trim()
  const loweredQuery = trimmed.toLowerCase()
  const matches = options.filter((option) => trimmed === '' || option.label.toLowerCase().includes(loweredQuery))
  const enabled = matches.filter((option) => !option.disabled)
  const active = enabled.length === 0 ? undefined : enabled[Math.min(activeIndex, enabled.length - 1)]
  const activeMatchIndex = active ? matches.findIndex((option) => option.value === active.value) : -1
  const canCreate =
    onCreate !== undefined && trimmed !== '' && !options.some((option) => option.label === trimmed)

  const toggle = (value: string) => {
    const option = options.find((candidate) => candidate.value === value)
    if (option?.disabled) return
    onChange(values.includes(value) ? values.filter((current) => current !== value) : [...values, value])
  }

  const clearAll = () => {
    onChange([])
  }

  const removeLast = () => {
    if (values.length === 0) return
    onChange(values.slice(0, -1))
  }

  const create = () => {
    if (!canCreate) return
    onCreate?.(trimmed)
    // 作った後は全体を見せる。打った文字は消す（作る対象が済んだため）。
    setQuery('')
    setActiveIndex(0)
  }

  const move = (direction: 1 | -1) => {
    if (enabled.length === 0) return
    setActiveIndex((current) => (current + direction + enabled.length) % enabled.length)
  }

  const focusInput = () => {
    inputRef.current?.focus()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setActiveIndex(event.key === 'ArrowDown' ? 0 : Math.max(0, enabled.length - 1))
      } else {
        move(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open || enabled.length === 0) return
      event.preventDefault()
      setActiveIndex(event.key === 'Home' ? 0 : enabled.length - 1)
      return
    }
    if (event.key === 'Enter') {
      if (!open) {
        setOpen(true)
        return
      }
      event.preventDefault()
      if (active) toggle(active.value)
      else if (canCreate && matches.length === 0) create()
      return
    }
    if (event.key === 'Backspace' && query === '') {
      removeLast()
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const statusText = !open ? '' : loading ? '探しています' : `${matches.length}件の候補`

  return (
    <div
      ref={rootRef}
      className={[styles.root, className].filter(Boolean).join(' ')}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
      data-design-node="WUVcz"
    >
      {name
        ? values.map((value) => <input key={value} type="hidden" name={name} value={value} disabled={disabled} />)
        : null}
      <div
        className={[styles.field, open ? styles.open : null, error ? styles.invalid : null, disabled ? styles.disabled : null]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          if (!disabled) {
            setOpen(true)
            focusInput()
          }
        }}
      >
        {visibleChips.map((chip) => (
          <span key={chip.value} className={styles.chip} title={chip.label}>
            {chip.dot ? <span aria-hidden="true" data-dot={chip.dot} className={styles.dot} /> : null}
            <span className={styles.chipLabel}>{chip.label}</span>
            {!disabled ? (
              <button
                type="button"
                aria-label={`「${chip.label}」を外す`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  toggle(chip.value)
                  focusInput()
                }}
                className={styles.chipRemove}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
        {overflowCount > 0 ? (
          <button
            type="button"
            aria-label={`残り${overflowCount}件を表示`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(true)
              focusInput()
            }}
            className={styles.overflow}
          >
            +{overflowCount}
          </button>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && active ? `${listboxId}-${activeMatchIndex}` : undefined}
          aria-autocomplete="list"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          aria-busy={loading || undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected.length === 0 ? placeholder : undefined}
          value={query}
          onFocus={() => {
            if (!disabled) setOpen(true)
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
            if (!disabled) setOpen(true)
          }}
          onKeyDown={onInputKeyDown}
          className={styles.input}
        />
      </div>
      {open ? (
        <div className={styles.popup}>
          <div className={styles.summary}>
            <span>{values.length}件選択中</span>
            <button type="button" disabled={disabled || values.length === 0} onClick={clearAll} className={styles.clearAll}>
              すべて外す
            </button>
          </div>
          {loading ? (
            <p className={styles.loading}>
              <span aria-hidden="true" className={styles.spinner} />
              探しています…
            </p>
          ) : matches.length > 0 ? (
            <ul id={listboxId} role="listbox" aria-label={`${ariaLabel}の候補`} className={styles.list}>
              {matches.map((option, index) => {
                const isActive = active !== undefined && option.value === active.value
                const isSelected = values.includes(option.value)
                return (
                  <li
                    key={option.value}
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    data-active={isActive || undefined}
                    title={option.hint ? `${option.label} ${option.hint}` : option.label}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggle(option.value)}
                    className={styles.option}
                  >
                    {/* 行の印は共通 Checkbox。押すのは行なので印に焦点は当てない。 */}
                    <span aria-hidden="true" className={styles.check}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(option.value)}
                        tabIndex={-1}
                        aria-label={option.label}
                        disabled={option.disabled}
                      />
                    </span>
                    {option.dot ? <span aria-hidden="true" data-dot={option.dot} className={styles.dot} /> : null}
                    <span className={styles.label}>
                      <OptionMatch label={option.label} query={trimmed} />
                    </span>
                    {option.hint ? <span className={styles.hint}>{option.hint}</span> : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyText}>{trimmed === '' ? '候補はありません' : (emptyText?.(trimmed) ?? `「${trimmed}」に合う候補はありません`)}</p>
              {canCreate ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={create}
                  className={styles.create}
                >
                  <Plus aria-hidden="true" />
                  {createLabel?.(trimmed) ?? `「${trimmed}」を新しく作る`}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {open ? (
        <span role="status" className={styles.status}>
          {statusText}
        </span>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
