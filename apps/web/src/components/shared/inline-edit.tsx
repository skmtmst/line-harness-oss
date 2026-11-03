'use client'

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './inline-edit.module.css'
import { usePermissionLockTip } from './permission-lock-tip'
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
  /** 権限だけの理由。未指定時の形・操作・Tab順は変えない。 */
  lockedReason?: string
  /** 保持した操作も、実行直前の本人・対象・権限で確かめる。 */
  canSaveNow?: () => boolean
  preserveDirtyOnBlur?: boolean
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
  resetToken?: number
}

/**
 * その場の書き換え（V8「サクサク感」C②）。押すと入力欄になり、
 * Enter で保存・Esc でやめる。保存中は押せなくなり、失敗したら
 * 下書きを残して理由を出す。V8 のときだけ開閉の感じが付く。
 */
export default function InlineEdit({ value, label, onSave, placeholder, maxLength, disabled = false, lockedReason, canSaveNow, preserveDirtyOnBlur = false, onDirtyChange, onSavingChange, resetToken }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const permission = useRef({ disabled, lockedReason, canSaveNow })
  permission.current = { disabled, lockedReason, canSaveNow }
  const hasPermission = () => lockedReason !== undefined || canSaveNow !== undefined
    || permission.current.lockedReason !== undefined || permission.current.canSaveNow !== undefined
  const canUseNow = () => !permission.current.disabled && !permission.current.lockedReason
    && (!permission.current.canSaveNow || permission.current.canSaveNow())
  const tip = usePermissionLockTip<HTMLElement>(lockedReason)

  useLayoutEffect(() => { onDirtyChange?.(editing && draft !== value) }, [draft, editing, value, onDirtyChange])
  useLayoutEffect(() => { onSavingChange?.(saving) }, [saving, onSavingChange])
  const previousReset = useRef(resetToken)
  useEffect(() => {
    if (previousReset.current === resetToken) return
    previousReset.current = resetToken
    setDraft(value)
    setError('')
    setEditing(false)
  }, [resetToken, value])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // 外から値が変わったら、下書きも追う（編集中は触らない）。
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  const start = () => {
    if ((hasPermission() ? !canUseNow() : disabled) || saving) return
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
    if (hasPermission() && !canUseNow()) return
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
      <><button type="button" className={styles.view} onClick={start} disabled={disabled} aria-label={`${label}を変更する`}
        {...tip.handlers} ref={lockedReason ? node => { tip.ref.current = node } : undefined}>
        <span className={styles.viewValue}>{value || placeholder || '—'}</span>
      </button>{tip.node}</>
    )
  }
  return (
    <span className={styles.edit}>
      <input
        {...tip.handlers}
        ref={lockedReason ? node => { inputRef.current = node; tip.ref.current = node } : inputRef}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={saving}
        readOnly={lockedReason || (hasPermission() && disabled) ? true : undefined}
        aria-disabled={lockedReason || (hasPermission() && disabled) ? true : undefined}
        onChange={(event) => { if (!hasPermission() || canUseNow()) setDraft(event.target.value) }}
        onKeyDown={(event) => {
          // 変換中の Enter（確定）・Esc（変換をやめる）は入力欄のもの。保存・取り消しにしない。
          if (event.defaultPrevented || isImeComposing(event)) return
          tip.handlers?.onKeyDown(event)
          if (event.defaultPrevented) return
          if (event.key === 'Enter') { event.preventDefault(); void save() }
          else if (event.key === 'Escape') { event.preventDefault(); cancel() }
        }}
        onBlur={() => {
          // ぶれたらやめる（勝手に保存しない）。
          tip.handlers?.onBlur()
          if (!saving && !error && !(preserveDirtyOnBlur && draft !== value) && (!hasPermission() || canUseNow())) cancel()
        }}
        className={styles.input}
      />
      {tip.node}
      {saving ? <span className={styles.saving} role="status">保存中…</span> : null}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
