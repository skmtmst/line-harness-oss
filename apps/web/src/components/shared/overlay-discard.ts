'use client'
import { useCallback, useEffect, useState } from 'react'

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
