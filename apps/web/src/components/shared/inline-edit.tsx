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
 * 元の値に戻して理由を出す。V8 のときだけ開閉の感じが付く。
 */
export default function InlineEdit({ value, label, onSave, placeholder, maxLength, disabled = false }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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
    setDraft(value)
    setError('')
    setEditing(false)
  }

  const save = async () => {
    if (saving) return
    if (draft === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(draft)
      setEditing(false)
    } catch {
      // 失敗したら元の値に戻して理由を出す（B：裏で保存・表で理由）。
      setDraft(value)
      setError('保存できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
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
          if (isImeComposing(event)) return
          if (event.key === 'Enter') void save()
          else if (event.key === 'Escape') cancel()
        }}
        onBlur={() => {
          // ぶれたらやめる（勝手に保存しない）。
          if (!saving) cancel()
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
