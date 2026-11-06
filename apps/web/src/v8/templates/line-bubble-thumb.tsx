'use client'

import type { InsertTokenNames } from '@/components/shared/insert-tokens'
import { InsertText } from '@/components/shared/insert-text-field'
import { GalleryHorizontalEnd, HelpCircle, Image as ImageIcon, LayoutGrid, LayoutTemplate, Video, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { BubbleThumb } from './line-bubble-thumb-model'
import styles from './line-bubble-thumb.module.css'

/** 小さな絵の大きさ。読み込み前から場所を取って、行の高さを揺らさない。 */
const IMAGE_W = 48
const IMAGE_H = 30

function Labeled({ icon: Icon, title, fallback, extra }: { icon: LucideIcon; title: string; fallback: string; extra?: string }) {
  return (
    <span className={styles.bubble}>
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.line}>{title || fallback}</span>
      {extra ? <span className={styles.extra}>{extra}</span> : null}
    </span>
  )
}

/** 読めなかった絵は壊れた印を出さず、「画像」の印と文に替える。 */
function ImageThumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Labeled icon={ImageIcon} title="" fallback="画像" />
  // eslint-disable-next-line @next/next/no-img-element -- 静的書き出しなので最適化の口が無い。小さく遅らせて読む
  return <img className={styles.image} src={src} alt="" width={IMAGE_W} height={IMAGE_H} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function bodyOf(thumb: BubbleThumb, tokenNames?: InsertTokenNames): ReactNode {
  switch (thumb.kind) {
    case 'text':
      return <span className={styles.bubble}><span className={styles.line}><InsertText value={thumb.text} tokenNames={tokenNames} /></span></span>
    case 'image':
      return <ImageThumb key={thumb.src} src={thumb.src} />
    case 'card':
      return <Labeled icon={LayoutTemplate} title={thumb.title} fallback="カード型" />
    case 'carousel':
      return <Labeled icon={GalleryHorizontalEnd} title={thumb.title} fallback="カルーセル" extra={`${thumb.count}枚`} />
    case 'question':
      return <Labeled icon={HelpCircle} title={thumb.text} fallback="質問" extra={`選択肢 ${thumb.choices}`} />
    case 'rich_message':
      return <Labeled icon={LayoutGrid} title={thumb.title} fallback="リッチメッセージ" />
    case 'rich_video':
      return <Labeled icon={Video} title={thumb.title} fallback="リッチビデオ" />
    case 'empty':
      return <span className={styles.note}>本文がありません</span>
    case 'unavailable':
      return <span className={styles.note}>見え方を出せません</span>
  }
}

/**
 * テンプレートの中身を、トークの地に小さな吹き出し1つで見せる（LINE での見え方の目安）。
 * 名前の読み上げを邪魔しない飾りなので、読み上げからは外す。
 */
export default function LineBubbleThumb({ thumb, tokenNames }: { thumb: BubbleThumb; tokenNames?: InsertTokenNames }) {
  const muted = thumb.kind === 'empty' || thumb.kind === 'unavailable'
  return (
    <div className={styles.talk} data-tone={muted ? 'muted' : undefined} data-line-bubble-thumb={thumb.kind} aria-hidden="true">
      {bodyOf(thumb, tokenNames)}
    </div>
  )
}
