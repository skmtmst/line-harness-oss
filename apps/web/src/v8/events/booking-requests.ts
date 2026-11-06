import { useEffect, useMemo, useRef } from 'react'

type Frame = { key: string; active: boolean; requests: Map<string, object> }

/** 店・イベント・開催回が変わった後の返事と、同じ操作の二重実行を除く。 */
export function useBookingRequests(key: string) {
  const current = useRef<Frame>({ key, active: true, requests: new Map() })
  if (current.current.key !== key) current.current = { key, active: true, requests: new Map() }
  const frame = current.current
  useEffect(() => {
    frame.active = true
    return () => { frame.active = false; frame.requests.clear() }
  }, [frame])
  return useMemo(() => ({
    key,
    start(kind: string, replace = false) {
      if (!frame.active || current.current !== frame || (!replace && frame.requests.has(kind))) return null
      const request = {}
      frame.requests.set(kind, request)
      return {
        isCurrent: () => frame.active && current.current === frame && frame.requests.get(kind) === request,
        finish() { if (frame.requests.get(kind) === request) frame.requests.delete(kind) },
      }
    },
  }), [key, frame])
}
