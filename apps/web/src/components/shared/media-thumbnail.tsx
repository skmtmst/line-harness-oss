'use client'

import { useEffect, useState } from 'react'
import { FileAudio, FileText, Play } from 'lucide-react'
import styles from './media-thumbnail.module.css'

/** 登録メディアの縮小表示。画像の失敗と動画・書類の見分けを保つ。 */
export default function MediaThumbnail({ kind, src, alt }: { kind: 'image' | 'video' | 'audio' | 'file'; src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (kind === 'image') return failed
    ? <span className={styles.failure}>画像を表示できません</span>
    // 静的書き出しでは認証付きURLをそのまま読む。
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={styles.image} />
  const Icon = kind === 'video' ? Play : kind === 'audio' ? FileAudio : FileText
  return <span className={styles.placeholder} data-media-thumbnail="" data-kind={kind} role="img" aria-label={alt}><Icon aria-hidden="true" /></span>
}
