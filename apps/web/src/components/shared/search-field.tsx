'use client'

import { LoaderCircle, Search, X } from 'lucide-react'
import React, { forwardRef, useEffect, useRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import styles from './search-field.module.css'

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'aria-label'> {
  /**
   * #976 U087: 検索欄は見た目に常設ラベルがないので、placeholder だけだと
   * 入力後に「何を探す欄か」が残らず、読み上げでも名前を取れない。
   * 呼び出し側に名前を必須にする。「友だちを検索」のように目的語まで書く。
   */
  'aria-label': string
  loading?: boolean
  onChange: (value: string) => void
  onClear?: () => void
  /**
   * 箱の右端に出す近道の印（例 '⌘K'。x6QsVz・v19Ivv・I1E7Bt の絵どおり）。
   * 渡すとその押し合わせでこの欄へ飛ぶ。v8 だけで見せ、v7 は変えない。
   */
  shortcut?: string
}

/** Pencil V5 `phlR1` を正本にした検索欄。 */
const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, disabled, hidden, loading = false, onChange, onClear, shortcut, value, ...props },
  ref,
) {
  const hasValue = String(value ?? '').length > 0
  const innerRef = useRef<HTMLInputElement>(null)
  /*
   * 近道の印は飾りで終わらせない：押したらこの欄へ飛ぶ。
   * 文字を書いている最中の ⌘K は奪わない。
   */
  useEffect(() => {
    if (!shortcut || disabled || hidden) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      event.preventDefault()
      const el = innerRef.current ?? (typeof ref === 'object' && ref ? ref.current : null)
      el?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut, disabled, hidden, ref])
  const setRefs = (node: HTMLInputElement | null) => {
    innerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  return (
    <div
      className={[styles.search, disabled ? styles.disabled : null, className]
        .filter(Boolean)
        .join(' ')}
      aria-busy={loading || undefined}
      hidden={hidden}
      data-design-node="phlR1"
    >
      <Search className={styles.searchIcon} aria-hidden="true" strokeWidth={2} />
      <input
        ref={setRefs}
        type="search"
        value={value}
        disabled={disabled}
        className={styles.input}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
      {shortcut ? (
        <kbd className={styles.shortcut} aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}
      {loading ? (
        <LoaderCircle className={styles.loadingIcon} aria-label="検索中" />
      ) : hasValue && onClear ? (
        <button type="button" className={styles.clear} onClick={onClear} aria-label="検索語を消す">
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
})

export default SearchField
