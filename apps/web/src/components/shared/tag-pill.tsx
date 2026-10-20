'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import TruncatedText from './truncated-text'
import styles from './tag-pill.module.css'

export interface TagPillProps {
  name: string
  'aria-label'?: string
  /** API が返すフォルダの色。未分類は薄い灰色の点。 */
  color?: string | null
  /** 一覧の名前の丸を兼ねる場合のフォルダ名。未分類も明示する。 */
  folderName?: string
  size?: 'md' | 'sm' | 'xs'
  /** 狭い一覧で行の高さを保つ。通常幅の札は変えない。 */
  compactAtNarrow?: boolean
  href?: string
  onRemove?: () => void
}

function TagName({ name, color, folderName }: Pick<TagPillProps, 'name' | 'color' | 'folderName'>) {
  const folderLabel = folderName === undefined ? undefined : `フォルダ：${folderName}`
  return <>
    <span className={styles.dot} style={color ? { backgroundColor: color } : undefined}
      data-folder-dot={folderLabel ? (color ? 'filed' : 'unfiled') : undefined}
      role={folderLabel ? 'img' : undefined} aria-label={folderLabel} title={folderLabel}
      aria-hidden={folderLabel ? undefined : true} />
    <TruncatedText className={styles.name} value={name} />
  </>
}

/** V8 のタグ札。管理画面 の呼び出し元は従来の部品を使う。リンクと外すボタンは兄弟にする。 */
export default function TagPill({ name, color, folderName, size = 'md', compactAtNarrow, href, onRemove, 'aria-label': ariaLabel }: TagPillProps) {
  return (
    <span className={styles.pill} data-size={size} data-compact-narrow={compactAtNarrow || undefined} role="group" aria-label={ariaLabel ?? `タグ「${name}」`}>
      {href ? (
        <Link className={styles.link} href={href} aria-label={`タグ「${name}」を編集`} onClick={(event) => event.stopPropagation()}>
          <TagName name={name} color={color} folderName={folderName} />
        </Link>
      ) : <TagName name={name} color={color} folderName={folderName} />}
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
