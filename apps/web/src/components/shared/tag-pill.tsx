'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import styles from './tag-pill.module.css'

export interface TagPillProps {
  name: string
  /** API が返すフォルダの色。未分類は薄い灰色の点。 */
  color?: string | null
  size?: 'md' | 'sm'
  href?: string
  onRemove?: () => void
}

function TagName({ name, color }: Pick<TagPillProps, 'name' | 'color'>) {
  return <>
    <span className={styles.dot} style={color ? { backgroundColor: color } : undefined} aria-hidden="true" />
    <span className={styles.name} title={name}>{name}</span>
  </>
}

/** V8 のタグ札。V7 の呼び出し元は従来の部品を使う。リンクと外すボタンは兄弟にする。 */
export default function TagPill({ name, color, size = 'md', href, onRemove }: TagPillProps) {
  return (
    <span className={styles.pill} data-size={size} role="group" aria-label={`タグ「${name}」`}>
      {href ? (
        <Link className={styles.link} href={href} title={name} aria-label={`タグ「${name}」を編集`} onClick={(event) => event.stopPropagation()}>
          <TagName name={name} color={color} />
        </Link>
      ) : <TagName name={name} color={color} />}
      {onRemove ? (
        <button type="button" className={styles.remove} aria-label={`${name}を外す`} onClick={(event) => { event.stopPropagation(); onRemove() }}>
          <X aria-hidden="true" />
        </button>
      ) : null}
    </span>
  )
}

/** 条件づくりの付け外し。札全体がボタンで、選択状態を読み上げる。 */
export function TagToggle({ name, color, selected, onToggle }: Pick<TagPillProps, 'name' | 'color'> & {
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button type="button" className={`${styles.pill} ${styles.toggle}`} data-size="md" data-selected={selected} aria-pressed={selected} onClick={onToggle}>
      <TagName name={name} color={color} />
    </button>
  )
}
