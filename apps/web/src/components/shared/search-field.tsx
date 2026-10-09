'use client'

import { LoaderCircle, Search, X } from 'lucide-react'
import React, { forwardRef, useRef } from 'react'
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
  /** @deprecated ⌘K は探す窓専用。古い呼び出しでも印や合図を出さない。 */
  shortcut?: string
}

/** Pencil V5 `phlR1` を正本にした検索欄。 */
const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, disabled, hidden, loading = false, onChange, onClear, shortcut: _shortcut, value, ...props },
  ref,
) {
  const hasValue = String(value ?? '').length > 0
  const innerRef = useRef<HTMLInputElement>(null)
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
