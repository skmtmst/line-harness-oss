'use client'
import { useCallback, useEffect, useState, type MouseEvent } from 'react'

/** 独自の操作段も、入れ子の窓を除いて共通の閉じる口へ通す。 */
export function captureOverlayClose(event: MouseEvent<HTMLElement>, guarded: boolean, requestClose: () => void) {
  const button = (event.target as Element).closest?.('button')
  if (!guarded || !button || button.closest('[role="dialog"],[role="alertdialog"]') !== event.currentTarget) return
  if (button.dataset.overlayClose === 'false') return
  if (button.hasAttribute('data-overlay-close') || /^(閉じる|キャンセル)$/.test(button.textContent?.trim() ?? '')) {
    event.preventDefault()
    event.stopPropagation()
    requestClose()
  }
}

/** Esc・背景・×・フッターを同じ確認に通す。保存成功の閉じ方は呼び出し側が持つ。 */
export function useOverlayDiscard(open: boolean, dirty: boolean, busy: boolean, close: () => void) {
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { if (!open || !dirty) setConfirming(false) }, [open, dirty])
  const requestClose = useCallback(() => {
    if (busy) return
    if (dirty) setConfirming(true)
    else close()
  }, [busy, dirty, close])
  const discard = () => { if (!busy) { setConfirming(false); close() } }
  return { confirming: open && confirming, requestClose, discard, continueEditing: () => setConfirming(false) }
}
