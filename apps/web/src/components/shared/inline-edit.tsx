'use client'

import React, { useEffect, useRef, useState } from 'react'
import styles from './inline-edit.module.css'
import { isImeComposing } from './ime'

export type InlineEditProps = {
  /** 今の値（実データ）。 */
  value: string
  /** 押したときの見出し（読み上げ用）。 */
  label: string
  /** Enter で保存する。失敗したら throw するか false を返す。 */
  onSave: (next: string) => Promise<unknown>
  placeholder?: string
  maxLength?: number
  disabled?: boolean
}

/**
 * その場の書き換え（V8「サクサク感」C②）。押すと入力欄になり、
 * Enter で保存・Esc でやめる。保存中は押せなくなり、失敗したら
 * 下書きを残して理由を出す。V8 のときだけ開閉の感じが付く。
 */
export default function InlineEdit({ value, label, onSave, placeholder, maxLength, disabled = false }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // 外から値が変わったら、下書きも追う（編集中は触らない）。
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  const start = () => {
    if (disabled || saving) return
    setDraft(value)
    setError('')
    setEditing(true)
  }

  const cancel = () => {
    if (saving) return
    setDraft(value)
    setError('')
    setEditing(false)
  }

  const save = async () => {
    if (savingRef.current) return
    if (draft === value) {
      setEditing(false)
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const result = await onSave(draft)
      if (result === false) throw new Error('save_failed')
      setEditing(false)
    } catch {
      // §6.11.9：失敗後も入力を保ち、Enterで同じ下書きを再試行できる。
      setError('保存できませんでした。入力は残っています。もう一度お試しください。')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" className={styles.view} onClick={start} disabled={disabled} aria-label={`${label}を変更する`}>
        <span className={styles.viewValue}>{value || placeholder || '—'}</span>
      </button>
    )
  }
  return (
    <span className={styles.edit}>
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // 変換中の Enter（確定）・Esc（変換をやめる）は入力欄のもの。保存・取り消しにしない。
          if (event.defaultPrevented || isImeComposing(event)) return
          if (event.key === 'Enter') { event.preventDefault(); void save() }
          else if (event.key === 'Escape') { event.preventDefault(); cancel() }
        }}
        onBlur={() => {
          // ぶれたらやめる（勝手に保存しない）。
          if (!saving && !error) cancel()
        }}
        className={styles.input}
      />
      {saving ? <span className={styles.saving} role="status">保存中…</span> : null}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
