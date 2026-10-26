'use client'

import { User } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { nameInitial } from '@/lib/name-initial'
import styles from './avatar.module.css'

/**
 * 友だちの顔。Pencil ★V8「顔/小・中・大」（`MFTlt`・`pDKi6`・`zjEbn`）。
 *
 * - 画像があって読み込めた時だけ画像。無い・**読み込みに失敗した**時は頭文字
 *   （2026-09-24 の点検で、失敗した画像が空白のまま出ていた）
 * - 頭文字と人の印は共通の中立色。同じ人を名前で見分けられるようにする
 *   （名前を必ず隣に出す）ので、顔は飾り（alt=""）
 * - 名前も無い時は人の印
 */
export default function Avatar({
  name,
  src,
  size = 40,
  className,
  shape = 'circle',
  tone = 'neutral',
  alt,
  style,
}: {
  name?: string | null
  src?: string | null
  size?: 24 | 28 | 32 | 34 | 36 | 40 | 52 | 56
  className?: string
  /** アカウントなどは丸角の四角、人・友だちは丸。 */
  shape?: 'circle' | 'rounded'
  /** 薄い灰の地（既定）か、青い淡色の地か。 */
  tone?: 'neutral' | 'soft'
  /** 画像に意味を持たせる時だけ渡す（アカウント名）。省略時は飾り。 */
  alt?: string | null
  style?: CSSProperties
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src
  const label = (name ?? '').trim()
  /*
   * アカウント・会社の印（丸角の四角）は、画像が無いときも会社の印と同じ
   * 緑の地に白の1文字にする。人の顔（丸）は
   * 今までどおり薄い地のまま。同じ帯に画像あり／なしが並んでもそろって見える。
   */
  const accountMark = !showImage && Boolean(label) && shape === 'rounded'
  const classes = [
    styles.avatar,
    styles[`s${size}`],
    showImage ? '' : accountMark ? styles.accountInitials : styles[`t${avatarToneIndex(label)}`],
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const labelled = typeof alt === 'string' && alt.trim().length > 0

  return (
    <span
      className={classes}
      aria-hidden={labelled ? undefined : 'true'}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? alt : undefined}
      data-avatar={showImage ? 'image' : label ? 'initials' : 'icon'}
      data-avatar-shape={shape}
      data-avatar-tone={accountMark ? 'account' : tone === 'soft' ? 'soft' : undefined}
      style={style}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- LINE CDN の利用者画像。大きさは固定で最適化は要らない。
        <img width={40} height={40} src={src!} alt={labelled ? alt : ''} className={styles.image} onError={() => setFailedSrc(src ?? null)} />
      ) : label ? (
        avatarInitials(label)
      ) : (
        <User aria-hidden="true" width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} />
      )}
    </span>
  )
}

/**
 * 頭文字はいつも1字。英字は最初の1字を大文字、日本語は最初の1字。
 * 会社名は先頭の「株式会社」などの法人格と記号を飛ばす（`nameInitial`）。
 */
export function avatarInitials(name: string): string {
  const first = nameInitial(name)
  return /^[a-z]$/.test(first) ? first.toUpperCase() : first
}

/** 名前から 0〜5 を決める。同じ名前はいつも同じ色。 */
export function avatarToneIndex(name: string): number {
  return [...name].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0) % 6
}
