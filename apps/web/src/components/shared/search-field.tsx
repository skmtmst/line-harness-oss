'use client'

import { LoaderCircle, Search, X } from 'lucide-react'
import React, { forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import styles from './search-field.module.css'

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  loading?: boolean
  onChange: (value: string) => void
  onClear?: () => void
}

/** Pencil V5 `phlR1` を正本にした検索欄。 */
const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, disabled, hidden, loading = false, onChange, onClear, value, ...props },
  ref,
) {
  const hasValue = String(value ?? '').length > 0
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
        ref={ref}
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
