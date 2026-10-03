'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * 行を消すときの合図。`leave(id)` で消え始めの印を付け、150ms
 *（`--motion-exit` と同じ速さ）待ってから `finish` を呼ぶ。
 * 動きを減らす設定では CSS 側が一瞬にするので、待ち自体は残す。
 */
const LEAVE_MS = 150

export function useRowLeaving(): {
  leavingId: string | null
  leave: (id: string, finish: () => void | Promise<void>) => void
} {
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  const leave = useCallback((id: string, finish: () => void | Promise<void>) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setLeavingId(id)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setLeavingId(null)
      void finish()
    }, LEAVE_MS)
  }, [])

  return { leavingId, leave }
}
