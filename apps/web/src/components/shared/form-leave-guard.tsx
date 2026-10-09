'use client'
import { useEffect, useRef } from 'react'
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
