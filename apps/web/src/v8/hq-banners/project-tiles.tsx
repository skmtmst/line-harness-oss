'use client'
import {
type BannerImage
} from '@/lib/hq-banners'
import { Hourglass } from 'lucide-react'
import { useState } from 'react'
import styles from './project.module.css'



/** 作っている途中の1枚（「作っています…」「待っています」）。 */
export function PendingTile({ running, label }: { running: boolean; label: string }) {
  return (
    <article className={styles.tile} role="status" aria-live="polite">
      <div className={`${styles.tileImage} ${styles.pending}`}>
        <Hourglass aria-hidden="true" className={styles.pendingIcon} />
        <span className={styles.pendingText}>{running ? '作っています…' : '待っています'}</span>
      </div>
      <div className={styles.tileMeta}><span className={styles.metaText}>{label}</span></div>
    </article>
  )
}


/** 画像の1枚。読めない画像は壊れた印を出さず、地の色のままにする。 */
export function Thumb({ image }: { image: BannerImage }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={styles.thumb}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {!failed ? <img src={image.media.url} alt="" loading="lazy" onError={() => setFailed(true)} /> : null}
    </span>
  )
}
