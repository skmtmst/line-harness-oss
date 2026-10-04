'use client'

import { useEffect, useState } from 'react'

/**
 * 画面幅が1152相当まで狭いか。1152の板（`WPrd5` など）の
 * `data-design-node` を切り替えるためだけに使う。見た目の折り畳み自体は
 * 各画面のCSS（コンテナ・メディアクエリ）が担う。
 */
export function useNarrowViewport(maxWidth = 1280): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const sync = () => setNarrow(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [maxWidth])
  return narrow
}
