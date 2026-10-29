'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'
import Button from './button'
import Notice from './notice'
import { STALE_STYLE_TEXT } from '@/hooks/use-account-style'

/*
 * 1 画面に 1 つだけ出すため、画面の本文が出している数を数える。
 * 本文が出していれば左メニュー（ShellStaleStyleNotice）は出さない。
 */
let pageNotices = 0
const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function changePageNotices(delta: number) {
  pageNotices += delta
  listeners.forEach(listener => listener())
}

function StaleStyleLine({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-stale-style-notice="">
      <Notice tone="warn" density="compact" role="status" action={<Button size="field" onClick={onRetry}>読み直す</Button>}>
        {`${STALE_STYLE_TEXT}。前に読めた表示で出しています。`}
      </Notice>
    </div>
  )
}

/** 使い方のスタイルを読み直せず、前に読めたスタイルで出している時の 1 行。読み直す口を 1 つだけ持つ。 */
export default function StaleStyleNotice({ onRetry }: { onRetry: () => void }) {
  useLayoutEffect(() => {
    changePageNotices(1)
    return () => changePageNotices(-1)
  }, [])
  return <StaleStyleLine onRetry={onRetry} />
}

/** 左メニューが出す同じ 1 行。画面の本文が StaleStyleNotice を出している間は出さない。 */
export function ShellStaleStyleNotice({ onRetry, className }: { onRetry: () => void; className?: string }) {
  const pageOwned = useSyncExternalStore(subscribe, () => pageNotices > 0, () => false)
  if (pageOwned) return null
  return <div className={className}><StaleStyleLine onRetry={onRetry} /></div>
}
