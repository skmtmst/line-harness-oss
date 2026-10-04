'use client'

import React from 'react'
import styles from './slide-panel.module.css'

export type SlideDirection = 'forward' | 'back' | 'none'

/**
 * ② 手順・タブの中身の移り変わり（V8「サクサク感」★A）。
 * 次へは右から 24px＋薄く、戻るは逆（240ms glide）。
 * 呼び出し側は今の段・タブの目印を `panelKey` に、進むか戻るかを
 * `direction` に渡す（目印が変わると1回だけ動く）。
 * 動きを減らす設定では動かず、そのまま入れ替わる。
 */
export default function SlidePanel({
  panelKey,
  direction,
  label,
  children,
}: {
  panelKey: string
  direction: SlideDirection
  label: string
  children: React.ReactNode
}) {
  return (
    <section
      key={panelKey}
      aria-label={label}
      data-slide-direction={direction}
      className={styles.panel}
    >
      {children}
    </section>
  )
}
