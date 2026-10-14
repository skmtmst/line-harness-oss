'use client'

import { useEffect, useRef, useState } from 'react'

/** 窓の幅が狭いときはフォルダの列を選ぶ欄に畳む（白い板 1100px 未満で畳む決まりに合わせる）。 */
export default function usePickerNarrow(threshold: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < threshold))
    observer.observe(node)
    return () => observer.disconnect()
  })
  return [ref, narrow] as const
}

