'use client'

import { useCallback, useState } from 'react'

/**
 * カーソル式ページ送りの束。一覧と実行結果で別々に書いていた重複 (#501-軽)。
 *
 * 戻る・進む・巻き戻しだけを受け持ち、取得は呼び出し側のままにする。
 * 振る舞いは変えない（巻き戻しは `[null]`、進むはカーソルを積む）。
 */
export function useCursorStack() {
  const [stack, setStack] = useState<Array<string | null>>([null])
  const reset = useCallback(() => setStack([null]), [])
  const goPrev = useCallback(
    () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    [],
  )
  const goNext = useCallback((nextCursor: string | null | undefined) => {
    if (nextCursor) setStack((current) => [...current, nextCursor])
  }, [])
  return {
    cursor: stack[stack.length - 1],
    page: stack.length,
    canPrev: stack.length > 1,
    reset,
    goPrev,
    goNext,
  }
}
