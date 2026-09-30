'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './bulk-bar.module.css'

export type BulkBarProps = {
  /** 選んでいる数。0 のときは何も出さない（下がって消える）。 */
  count: number
  /** 数の単位。規定は「件」（友だち一覧は「人」、写真は「枚」）。 */
  unit?: string
  /** 件数の右に出す補足（なぜ今この操作が出ているか等）。 */
  hint?: ReactNode
  /**
   * まとめ操作。白地ボタン（`Button variant="secondary"`）を
   * よく使う順に2つまで並べ、残りは「…」のメニューへ入れる。
   */
  children?: ReactNode
  /** 残りの操作を入れる「…」の押し口（メニューを開くボタン）。 */
  overflow?: ReactNode
  /**
   * 帯の下段。1件だけ選んだときの個別操作など、数行要る中身を
   * 帯の中へ横幅いっぱいで置くときに使う。
   */
  below?: ReactNode
  className?: string
}

/*
 * ★V7 仕上げ §2「一括バー」。表・一覧で1件でも選ぶと表の下端から
 * 8px上がって出る帯。0件で下がって消える。
 *
 * 置き場所は「表のすぐ下」。呼び出し側は条件分岐ではなく常に描き、
 * 件数だけを渡す（出る・消えるの動きは部品が持つ）。
 *
 * 動きの根拠:
 *   入る: 下8pxから浮き上がる（motion-base・ease-out）
 *   出る: 下がって消える（motion-fast）
 */
export default function BulkBar({ count, unit = '件', hint, children, overflow, below, className }: BulkBarProps) {
  const visible = count > 0
  const [rendered, setRendered] = useState(visible)

  useEffect(() => {
    if (visible) {
      setRendered(true)
      return
    }
    if (!rendered) return
    // 「下がって消える」を見せるため、出し終わるまで描き続ける。
    const timer = setTimeout(() => setRendered(false), 140)
    return () => clearTimeout(timer)
  }, [visible, rendered])

  if (!rendered) return null

  return (
    <div
      className={[styles.bar, visible ? styles.enter : styles.exit, className].filter(Boolean).join(' ')}
      role="region"
      aria-label="選択中のまとめ操作"
    >
      <strong className={styles.count}>
        {count}
        {unit}を選択中
      </strong>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
      {children || overflow ? (
        <span className={styles.actions}>
          {children}
          {overflow}
        </span>
      ) : null}
      {below ? <span className={styles.below}>{below}</span> : null}
    </div>
  )
}
