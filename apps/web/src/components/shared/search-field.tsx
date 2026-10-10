'use client'

import { LoaderCircle, Search, X } from 'lucide-react'
import React, { forwardRef, useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { guardCompositionEnter } from './composition-enter'
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
  { className, disabled, hidden, loading = false, onChange, onClear, shortcut: _shortcut, value, onKeyDown, ...props },
  ref,
) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const callback = useRef(onChange)
  callback.current = onChange
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composing = useRef(false)
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const schedule = (next: string) => { cancel(); timer.current = setTimeout(() => { timer.current = null; callback.current(next) }, 300) }
  useEffect(() => { cancel(); setDraft(String(value ?? '')) }, [value])
  useEffect(() => cancel, [])
  const hasValue = draft.length > 0
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
        value={draft}
        disabled={disabled}
        className={styles.input}
        onChange={(event) => { const next = event.target.value; setDraft(next); if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) schedule(next) }}
        {...props}
        onKeyDown={guardCompositionEnter(onKeyDown)}
        onCompositionStart={(event) => { composing.current = true; cancel(); props.onCompositionStart?.(event) }}
        onCompositionEnd={(event) => { composing.current = false; schedule(event.currentTarget.value); props.onCompositionEnd?.(event) }}
      />
      {loading ? (
        <LoaderCircle className={styles.loadingIcon} aria-label="検索中" />
      ) : hasValue && onClear ? (
        <button type="button" className={styles.clear} onClick={() => { cancel(); setDraft(''); onClear?.() }} aria-label="検索語を消す">
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
})

export default SearchField
