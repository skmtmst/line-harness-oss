'use client'

import type { ReactNode } from 'react'
import { useDelayedShow } from './skeleton'
import styles from './refresh-cover.module.css'

/*
 * 前の表示を残したまま読み直す。
 *
 * 絞り込み・並べ替え・ページ送りで中身を読み直す間、骨組みへ戻さず
 * いま出ている内容はそのまま、小さい「更新中」を出す。
 * 0.3 秒より早く答えが来たときは知らせを出さない（`useDelayedShow`）。
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
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {dimming ? <span role="status" className={styles.updating}>更新中</span> : null}
      <div
        aria-busy={refreshing || undefined}
      >
        {children}
      </div>
    </div>
  )
}
