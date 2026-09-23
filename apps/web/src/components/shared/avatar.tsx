'use client'

import { User } from 'lucide-react'
import { useState } from 'react'
import styles from './avatar.module.css'

/**
 * 友だちの顔。Pencil ★V7「友だちの顔」（V7 文書 `KXDhj`）。
 *
 * - 画像があって読み込めた時だけ画像。無い・**読み込みに失敗した**時は頭文字
 *   （2026-09-24 の点検で、失敗した画像が空白のまま出ていた）
 * - 色は名前から決まる6組。同じ人はどの画面でも同じ色。色だけで人を見分けさせない
 *   （名前を必ず隣に出す）ので、顔は飾り（alt=""）
 * - 名前も無い時は人の印
 */
export default function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name?: string | null
  src?: string | null
  size?: 24 | 32 | 40 | 56
  className?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src
  const label = (name ?? '').trim()
  const classes = [styles.avatar, styles[`s${size}`], showImage ? '' : styles[`t${avatarToneIndex(label)}`], className]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} aria-hidden="true" data-avatar={showImage ? 'image' : label ? 'initials' : 'icon'}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- LINE CDN の利用者画像。大きさは固定で最適化は要らない。
        <img src={src!} alt="" className={styles.image} onError={() => setFailedSrc(src ?? null)} />
      ) : label ? (
        avatarInitials(label)
      ) : (
        <User aria-hidden="true" width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} />
      )}
    </span>
  )
}

/** 英字は単語の頭2つ（Kyohei Yamamoto → KY）、それ以外は最初の1字。 */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length > 0 && /^[A-Za-z]/.test(words[0])) {
    return words
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('')
  }
  return [...name.trim()][0] ?? ''
}

/** 名前から 0〜5 を決める。同じ名前はいつも同じ色。 */
export function avatarToneIndex(name: string): number {
  return [...name].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0) % 6
}
