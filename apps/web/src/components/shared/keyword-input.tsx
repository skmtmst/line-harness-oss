'use client'

import { useRef, useState, type FormEventHandler } from 'react'
import { Search } from 'lucide-react'
import { AffixedTextField } from './text-field'
import styles from './keyword-input.module.css'

/** 言葉を1つずつ確定する欄。日本語の変換中は確定しない。 */
export default function KeywordInput({ id, label, placeholder = '言葉を入れて Enter', error, errorId, onAdd, onInput, maxLength }: {
  id: string
  label: string
  placeholder?: string
  error?: string
  errorId?: string
  onAdd: (word: string) => void
  onInput?: FormEventHandler<HTMLInputElement>
  maxLength?: number
}) {
  const [value, setValue] = useState('')
  const composing = useRef(false)
  const commit = () => {
    if (composing.current || !value.trim()) return
    onAdd(value.trim())
    setValue('')
  }
  return <span className={styles.entry} data-keyword-input>
    <AffixedTextField id={id} aria-label={label} placeholder={placeholder} maxLength={maxLength}
      startAdornment={<Search size={14} aria-hidden="true" />}
      invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
      value={value} onChange={event => setValue(event.target.value)} onInput={onInput}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing) return
        if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); commit() }
      }} onBlur={commit} />
  </span>
}
