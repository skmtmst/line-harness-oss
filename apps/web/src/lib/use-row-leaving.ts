'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motionMs, shouldAnimateLeave } from '@/components/shared/overlay-utils'

/** 成功済みの行に150msの合図を付ける。別の行の操作は先の完了を取り消さない。 */
export function useRowLeaving(): {
  leavingId: string | null
  leavingIds: string[]
  isLeaving: (id: string) => boolean
  leave: (id: string, finish: () => void | Promise<void>) => void
  leaveMany: (ids: string[], finish: () => void | Promise<void>) => void
} {
  const [leavingIds, setLeavingIds] = useState<string[]>([])
  const pending = useRef(new Set<string>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const completions = useRef(new Map<ReturnType<typeof setTimeout>, () => void>())

  useEffect(() => {
    const active = timers.current
    const callbacks = completions.current
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const settle = () => {
      if (!media?.matches) return
      for (const [timer, complete] of callbacks) { clearTimeout(timer); complete() }
    }
    media?.addEventListener?.('change', settle)
    return () => {
      for (const timer of active) clearTimeout(timer)
      active.clear(); callbacks.clear()
      media?.removeEventListener?.('change', settle)
    }
  }, [])

  const start = useCallback((ids: string[], finish: () => void | Promise<void>) => {
    const fresh = [...new Set(ids)].filter(id => !pending.current.has(id))
    if (ids.length > 0 && fresh.length === 0) return
    if (fresh.length === 0 || !shouldAnimateLeave()) {
      void finish()
      return
    }
    for (const id of fresh) pending.current.add(id)
    setLeavingIds([...pending.current])
    const complete = () => {
      timers.current.delete(timer)
      completions.current.delete(timer)
      for (const id of fresh) pending.current.delete(id)
      setLeavingIds([...pending.current])
      void finish()
    }
    const timer = setTimeout(complete, motionMs('--motion-exit', 150))
    timers.current.add(timer)
    completions.current.set(timer, complete)
  }, [])

  const leave = useCallback((id: string, finish: () => void | Promise<void>) => {
    start([id], finish)
  }, [start])
  const leaveMany = useCallback((ids: string[], finish: () => void | Promise<void>) => {
    start(ids, finish)
  }, [start])
  const isLeaving = useCallback((id: string) => leavingIds.includes(id), [leavingIds])
  return { leavingId: leavingIds[0] ?? null, leavingIds, isLeaving, leave, leaveMany }
}
