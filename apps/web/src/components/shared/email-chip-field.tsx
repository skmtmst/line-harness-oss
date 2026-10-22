'use client'

import { useState, type ComponentPropsWithRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import Chip from './chip'
import { TextField } from './text-field'
import styles from './email-chip-field.module.css'

type Props = Omit<ComponentPropsWithRef<typeof TextField>, 'value' | 'onChange' | 'type'> & {
  value: string
  onValueChange: (value: string) => void
}

/** 名前と担当範囲を持つ1人分の招待。複数の宛先を黙って切り捨てない。 */
export function EmailChipField({ value, onValueChange, onBlur, onFocus, onKeyDown, onPaste, invalid, disabled, id, ...props }: Props) {
  const [committed, setCommitted] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const email = value.trim()
  const problem = emailProblem(email)
  const showChip = committed === value.trim() && Boolean(committed) && !problem
  const commit = () => { setTouched(true); if (value.trim() && !problem) setCommitted(value.trim()) }
  const showError = touched && problem && !invalid
  const errorId = id ? `${id}-email-format` : undefined
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (showChip && event.key === 'Backspace') {
      event.preventDefault()
      setCommitted(null)
      return
    }
    if (event.key === 'Enter') { event.preventDefault(); commit() }
  }
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(event)
    if (event.defaultPrevented) return
    const pasted = event.clipboardData.getData('text').trim()
    if (!pasted) return
    event.preventDefault()
    const base = showChip ? '' : value
    const next = base.slice(0, event.currentTarget.selectionStart ?? base.length) + pasted
      + base.slice(event.currentTarget.selectionEnd ?? base.length)
    onValueChange(next)
    setTouched(true)
    setCommitted(next.trim())
  }
  return <div className={styles.root}>
    {showChip ? <Chip><span className={styles.address} title={value.trim()}>{value.trim()}</span><button type="button" className={styles.remove} disabled={disabled} aria-label={`${value.trim()}を外す`} onClick={() => { setCommitted(null); onValueChange(''); document.getElementById(id ?? '')?.focus() }}><X size={14} aria-hidden="true" /></button></Chip> : null}
    <TextField {...props} id={id} type="text" inputMode="email" autoComplete="email" disabled={disabled}
      value={showChip ? '' : value} readOnly={showChip || props.readOnly} placeholder={showChip ? '招待は1件ずつです。選ぶとメールを直せます' : props.placeholder} invalid={invalid || Boolean(touched && problem)}
      aria-describedby={[props['aria-describedby'], showError ? errorId : undefined].filter(Boolean).join(' ') || undefined}
      onChange={event => { setCommitted(null); onValueChange(event.target.value) }}
      onFocus={event => { setCommitted(null); onFocus?.(event) }}
      onBlur={event => { commit(); onBlur?.(event) }}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste} />
    {showError ? <p id={errorId} className={styles.error} role="alert">{problem}</p> : null}
  </div>
}

function emailProblem(email: string): string {
  if (!email) return ''
  if (/[,;\s]/.test(email)) return '招待は1件ずつ送ります。メールアドレスを1つ入力してください。'
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '正しいメールアドレスを入力してください。'
  return ''
}
