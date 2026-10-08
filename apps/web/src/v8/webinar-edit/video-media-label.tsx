'use client'

import { useEffect, useState } from 'react'
import type { MediaItem } from '@line-crm/shared'
import { api, type Webinar } from '@/lib/api'
import { fmtSec } from './helpers'
import styles from './video.module.css'

const MEDIA_KIND_LABEL: Record<MediaItem['kind'], string> = {
  image: '画像',
  video: '動画',
  audio: '音声',
  file: 'ファイル',
}

export default function VideoMediaLabel({ webinar }: { webinar: Webinar }) {
  const mediaId = webinar.videoMediaId ?? null
  const accountId = webinar.accountId ?? null
  const [media, setMedia] = useState<MediaItem | null>(null)

  useEffect(() => {
    setMedia(null)
    if (!mediaId || !accountId) return
    let cancelled = false
    api.media
      .detail(mediaId, accountId)
      .then((res) => {
        if (!cancelled && res.success) setMedia(res.data.item)
      })
      .catch(() => {
        /* 名前が取れなくても偽名は出さない。「設定済みの動画」に落ちる。 */
      })
    return () => {
      cancelled = true
    }
  }, [mediaId, accountId])

  if (!media) return <span className={styles.videoText}><span className={styles.videoName}>{!webinar.videoPrefix && !mediaId ? '—（未設定）' : '設定済みの動画'}</span></span>
  return (
    <span className={styles.videoText}>
      <span className={styles.videoName} title={media.filename}>
        {media.filename}
      </span>
      <span className={styles.videoMeta}>
        {MEDIA_KIND_LABEL[media.kind]}
        {media.durationMs !== null && media.durationMs > 0
          ? `・${fmtSec(Math.round(media.durationMs / 1000))}`
          : ''}
      </span>
    </span>
  )
}
