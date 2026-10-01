'use client'

import type { ReactNode } from 'react'
import { useDelayedShow } from './skeleton'

/*
 * 前の表示を残したまま読み直す（★V7 `sTJsh` §2）。
 *
 * 絞り込み・並べ替え・ページ送りで中身を読み直す間、骨組みへ戻さず
 * いま出ている内容を 0.55 に薄め、上に 2px の線の帯を出す。
 * 0.3 秒より早く答えが来たときは薄めない（`useDelayedShow`）。
 * 件数・ページ番号などは呼び出し側で「新しい答えが来るまで前のまま」にする。
 *
 * `refreshing` は「読み直し中」が分かるときだけ立てる。初回の読み込みは
 * 骨組み（`DelayedSkeleton` / `ListState kind="loading"`）が担当するので
 * ここには回さない。
 */
export function RefreshCover({
  refreshing,
  children,
  className,
}: {
  refreshing: boolean
  children: ReactNode
  className?: string
}) {
  const dimming = useDelayedShow(refreshing)
  return (
    <div className={['v7-refresh', className].filter(Boolean).join(' ')}>
      {dimming ? <div className="v7-refresh-line" aria-hidden="true" /> : null}
      <div
        className={dimming ? 'v7-refresh-dim' : undefined}
        aria-busy={refreshing || undefined}
      >
        {children}
      </div>
    </div>
  )
}
