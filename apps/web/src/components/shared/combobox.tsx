'use client'

import { ChevronsUpDown, Plus, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import styles from './combobox.module.css'

export type ComboboxDot = 'green' | 'blue' | 'amber' | 'gray'

export interface ComboboxOption {
  value: string
  label: string
  /** 行の右端の補足（設計の「テキスト」「カード」）。 */
  hint?: string
  /** 行頭・札の点。タグの識別色があるときだけ付ける。 */
  dot?: ComboboxDot
  disabled?: boolean
}

export interface ComboboxProps {
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
  /** 最初に入れておく打った途中の文字（見本・下書きの復元用）。 */
  initialText?: string
  /** 読み込み中は候補の場所を空けたまま「探しています…」を出す。 */
  loading?: boolean
  name?: string
  onChange: (value: string) => void
  /** 「＋ 新しく作る」を押したとき。渡したときだけ候補なしの行に出す。 */
  onCreate?: (query: string) => void
  options: ComboboxOption[]
  placeholder?: string
  value: string
}

/**
 * 候補つき入力（1つ選ぶ）。Pencil ★V7 `WUVcz`「候補つき入力・複数選択」§1。
 *
 * 形の手本は select.tsx（開閉・枠・誤り）と date-field（欄の 6px 下の
 * 候補・motion-fast の出方）。寸法・色・文字は WUVcz の書き出しから。
 *
 * - 打った文字で絞り込み、一致した所だけ太字。↑↓で選ぶ行は灰色の地
 * - 焦点は欄に残し、選ぶ行は aria-activedescendant で指す
 * - 件数は role=status で読む（「3件の候補」）。見た目には出さない
 * - Esc・外を押して閉じても、打った文字は残す
 * - 候補なしは「『○○』に合う候補はありません」＋任意の「＋ 新しく作る」
 */
export default function Combobox({
  'aria-label': ariaLabel,
  className,
  createLabel,
  defaultOpen = false,
  disabled = false,
  emptyText,
  error,
  id,
  initialText,
  loading = false,
  name,
  onChange,
  onCreate,
  options,
  placeholder,
  value,
}: ComboboxProps) {
  const generatedId = useId()
  const inputId = id ?? `${generatedId}-input`
  const listboxId = `${generatedId}-listbox`
  const errorId = `${generatedId}-error`
  const statusId = `${generatedId}-status`
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [activeIndex, setActiveIndex] = useState(0)

  // 決めた値。親が value を替えたときだけ、欄の文字を選び直しの表示に戻す。
  // 入力中の options 差し替え（非同期の探し直し）では上書きしない。
  const [committed, setCommitted] = useState(value)
  const [text, setText] = useState(() => initialText ?? options.find((option) => option.value === value)?.label ?? '')
  if (committed !== value) {
    setCommitted(value)
    setText(options.find((option) => option.value === value)?.label ?? '')
  }

  const query = text.trim()
  const loweredQuery = query.toLowerCase()
  const matches = options.filter((option) => query === '' || option.label.toLowerCase().includes(loweredQuery))
  const enabled = matches.filter((option) => !option.disabled)
  const active = enabled.length === 0 ? undefined : enabled[Math.min(activeIndex, enabled.length - 1)]
  const activeMatchIndex = active ? matches.findIndex((option) => option.value === active.value) : -1
  const canCreate = onCreate !== undefined && query !== '' && !options.some((option) => option.label === query)

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return
    onChange(option.value)
    setText(option.label)
    setOpen(false)
  }

  const create = () => {
    if (!canCreate) return
    onCreate?.(query)
    // 作った直後は一覧に無いので閉じる。打った文字は残す（Esc と同じ）。
    setOpen(false)
  }

  const clear = () => {
    onChange('')
    setText('')
    setActiveIndex(0)
    setOpen(true)
    inputRef.current?.focus()
  }

  const move = (direction: 1 | -1) => {
    if (enabled.length === 0) return
    setActiveIndex((current) => (current + direction + enabled.length) % enabled.length)
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
      if (active) choose(active)
      else if (canCreate && matches.length === 0) create()
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
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <div className={[styles.field, open ? styles.open : null, error ? styles.invalid : null, disabled ? styles.disabled : null].filter(Boolean).join(' ')}>
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
          placeholder={placeholder}
          value={text}
          onFocus={() => {
            if (!disabled) setOpen(true)
          }}
          onChange={(event) => {
            setText(event.target.value)
            setActiveIndex(0)
            if (!disabled) setOpen(true)
          }}
          onKeyDown={onInputKeyDown}
          className={styles.input}
        />
        {text !== '' && !disabled ? (
          <button type="button" aria-label="入力を消す" onMouseDown={(event) => event.preventDefault()} onClick={clear} className={`${styles.trailing} ${styles.clear}`}>
            <X aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={open ? '候補を閉じる' : '候補を開く'}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpen((current) => !current)
              inputRef.current?.focus()
            }}
            className={styles.trailing}
          >
            <ChevronsUpDown aria-hidden="true" />
          </button>
        )}
      </div>
      {open ? (
        <div className={styles.popup}>
          {loading ? (
            <p className={styles.loading}>
              <span aria-hidden="true" className={styles.spinner} />
              探しています…
            </p>
          ) : matches.length > 0 ? (
            <ul id={listboxId} role="listbox" aria-label={`${ariaLabel}の候補`} className={styles.list}>
              {matches.map((option, index) => {
                const isActive = active !== undefined && option.value === active.value
                const isSelected = option.value === value
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
                    onClick={() => choose(option)}
                    className={styles.option}
                  >
                    {option.dot ? <span aria-hidden="true" data-dot={option.dot} className={styles.dot} /> : null}
                    <span className={styles.label}>
                      <OptionMatch label={option.label} query={query} />
                    </span>
                    {option.hint ? <span className={styles.hint}>{option.hint}</span> : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyText}>{query === '' ? '候補はありません' : (emptyText?.(query) ?? `「${query}」に合う候補はありません`)}</p>
              {canCreate ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={create}
                  className={styles.create}
                >
                  <Plus aria-hidden="true" />
                  {createLabel?.(query) ?? `「${query}」を新しく作る`}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {/* 件数は見た目に出さず、読み上げにだけ渡す。 */}
      {open ? (
        <span id={statusId} role="status" className={styles.status}>
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

/** 打った文字に合う所だけ太字にする。合わない行はそのまま出す。 */
export function OptionMatch({ label, query }: { label: string; query: string }) {
  const trimmed = query.trim()
  if (trimmed === '') return <>{label}</>
  const found = label.toLowerCase().indexOf(trimmed.toLowerCase())
  if (found < 0) return <>{label}</>
  return (
    <>
      {label.slice(0, found)}
      <strong className={styles.match}>{label.slice(found, found + trimmed.length)}</strong>
      {label.slice(found + trimmed.length)}
    </>
  )
}
