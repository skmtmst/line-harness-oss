'use client'

import { useContext } from 'react'
import { OverlayDepthContext } from '@/components/shared/overlay-utils'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'

/** 登録・再開で保存前の入力を同じ確認で守る。 */
export default function RegistrationUnsavedGuard({ dirty, busy, onDiscard }: { dirty: boolean; busy: boolean; onDiscard: () => void }) {
  const depth = useContext(OverlayDepthContext)
  const guard = useUnsavedGuard({ dirty: dirty || busy, busy, onDiscard })
  return <OverlayDepthContext.Provider value={depth + 2}><UnsavedLeaveDialog open={guard.leaveTarget !== null} busy={busy} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} /></OverlayDepthContext.Provider>
}
