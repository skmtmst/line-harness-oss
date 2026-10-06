'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * 行を消すときの合図。`leave(id)` で消え始めの印を付け、150ms
 *（`--motion-exit` と同じ速さ）待ってから `finish` を呼ぶ。
 * 動きを減らす設定では CSS 側が一瞬にするので、待ち自体は残す。
 * まとめて消すときは `leaveMany(ids, finish)` を使う。
 */
const LEAVE_MS = 150

export function useRowLeaving(): {
  leavingId: string | null
  leavingIds: string[]
  isLeaving: (id: string) => boolean
  leave: (id: string, finish: () => void | Promise<void>) => void
  leaveMany: (ids: string[], finish: () => void | Promise<void>) => void
} {
  const [leavingIds, setLeavingIds] = useState<string[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  const start = useCallback((ids: string[], finish: () => void | Promise<void>) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    if (ids.length === 0) {
      void finish()
      return
    }
    setLeavingIds(ids)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setLeavingIds([])
      void finish()
    }, LEAVE_MS)
  }, [])

  const leave = useCallback((id: string, finish: () => void | Promise<void>) => {
    start([id], finish)
  }, [start])

  const leaveMany = useCallback((ids: string[], finish: () => void | Promise<void>) => {
    start([...ids], finish)
  }, [start])

  const isLeaving = useCallback((id: string) => leavingIds.includes(id), [leavingIds])

  return { leavingId: leavingIds[0] ?? null, leavingIds, isLeaving, leave, leaveMany }
}
