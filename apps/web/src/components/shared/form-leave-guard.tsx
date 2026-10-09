'use client'
import { useEffect, useRef } from 'react'
import { formInputSnapshot, useFormInputDirty } from './form-input-dirty'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'

/** 型に渡された未保存状態を、全画面共通の離脱確認へつなぐ。 */
export function FormLeaveGuard({ dirty, busy }: { dirty: boolean; busy?: boolean }) {
  const guard = useUnsavedGuard({ dirty, busy })
  const marker = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!dirty && !busy) return
    const frame = marker.current?.closest?.('[data-page-template]')
    let replaying = false
    const onClick = (event: MouseEvent) => {
      if (replaying) return
      const button = (event.target as Element)?.closest?.('button')
      if (!button || !frame?.contains(button) || button.closest('[role="dialog"], [role="alertdialog"]')) return
      if (!/^(キャンセル|閉じる)$/.test(button.textContent?.trim() ?? '')) return
      event.preventDefault(); event.stopPropagation()
      guard.guarded(() => { replaying = true; try { button.click() } finally { replaying = false } })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty, busy, guard.guarded])
  return <><span ref={marker} hidden /><UnsavedLeaveDialog open={guard.leaveTarget !== null} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} busy={busy} /></>
}

/** 初期値の読み込みでは警告せず、利用者が入力を変えたページだけを守る。 */
export function AutoFormLeaveGuard({ busy }: { busy?: boolean }) {
  const input = useFormInputDirty(true)
  const savingSnapshot = useRef<string | null>(null)
  useEffect(() => {
    const frame = input.ref.current
    if (!frame) return
    const change = () => input.onChangeCapture()
    const click = (event: Event) => {
      const target = event.target as Element
      if (target.closest('[role="dialog"],[role="alertdialog"]')) return
      if (target.closest('[aria-haspopup="listbox"],[role="switch"],[role="checkbox"],[role="radio"]')) input.onChangeCapture()
      const button = target.closest('button')
      if (button && /保存|作る|公開|更新|登録/.test(button.textContent ?? '')) savingSnapshot.current = formInputSnapshot(frame)
    }
    const saved = () => {
      if (savingSnapshot.current !== null) { input.resetBaseline(savingSnapshot.current); savingSnapshot.current = null }
    }
    frame.addEventListener('change', change, true)
    frame.addEventListener('input', change, true)
    frame.addEventListener('click', click, true)
    window.addEventListener('lh:form-saved', saved)
    return () => { frame.removeEventListener('change', change, true); frame.removeEventListener('input', change, true); frame.removeEventListener('click', click, true); window.removeEventListener('lh:form-saved', saved) }
  })
  return <><span hidden ref={(element) => { input.ref.current = element?.closest<HTMLElement>('[data-page-template],[data-create-variant]') ?? null }} />{input.dirty ? <FormLeaveGuard dirty busy={busy} /> : null}</>
}
