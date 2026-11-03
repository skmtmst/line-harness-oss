'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react'
import { useDetailPanelUrl } from './detail-panel'
import { OverlayDepthContext } from './overlay-utils'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'

/** 詳細パネルのその場編集と、行送り・履歴・画面移動を一つの確認で守る。 */
export const InlineDetailHoldingContext = createContext<((source: symbol, holding: boolean) => void) | null>(null)
export function useInlineDetailHoldingState() {
  const [sources, setSources] = useState<ReadonlySet<symbol>>(() => new Set())
  const onHoldingChange = useCallback((source: symbol, holding: boolean) => setSources(previous => {
    if (previous.has(source) === holding) return previous
    const next = new Set(previous)
    if (holding) next.add(source); else next.delete(source)
    return next
  }), [])
  return { holding: sources.size > 0, onHoldingChange }
}
export function useInlineDetailGuard(key: string) {
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const onHoldingChange = useContext(InlineDetailHoldingContext)
  const source = useRef(Symbol('detail'))
  useLayoutEffect(() => { onHoldingChange?.(source.current, dirty || busy) }, [dirty, busy, onHoldingChange])
  useLayoutEffect(() => () => { onHoldingChange?.(source.current, false) }, [onHoldingChange])
  const hold = useRef(false)
  hold.current = dirty || busy
  const [id, setIdRaw] = useDetailPanelUrl(key, () => hold.current)
  useEffect(() => { if (id === null) { setDirty(false); setBusy(false) } }, [id])
  const depth = useContext(OverlayDepthContext)
  const guard = useUnsavedGuard({ dirty: dirty || busy, busy, subject: '詳細パネルの変更', onDiscard: () => {
    hold.current = false
    setDirty(false)
    setResetToken(value => value + 1)
  } })
  const setId = useCallback((next: SetStateAction<string | null>) => guard.guarded(() => setIdRaw(next)), [guard.guarded, setIdRaw])
  const editor = { preserveDirtyOnBlur: true as const, onDirtyChange: setDirty, onSavingChange: setBusy, resetToken }
  const dialog = <OverlayDepthContext.Provider value={depth + 2}><UnsavedLeaveDialog open={guard.leaveTarget !== null} busy={busy} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} /></OverlayDepthContext.Provider>
  return { id, setId, protect: guard.guarded, busy, holding: dirty || busy, editor, dialog }
}

/** 一覧の再読込で行が一時的に消えても編集中の内容を保つ。別アカウントへは持ち越さない。 */
export function useHeldDetail<T extends { id: string }>(item: T | null, id: string | null, holding: boolean, scope: string | null) {
  const held = useRef<{ scope: string | null; item: T | null }>({ scope, item: null })
  if (held.current.scope !== scope) held.current = { scope, item: null }
  if (item) held.current.item = item
  else if (!holding || held.current.item?.id !== id) held.current.item = null
  return item ?? held.current.item
}
