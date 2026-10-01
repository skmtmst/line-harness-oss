import type { LucideIcon } from 'lucide-react'
import styles from './icon-tile.module.css'

/**
 * 印のタイル（Pencil ★V8 `C9CaMS`・`E7USZ9`・`A2mryd`）。
 *
 * アイコンを白い小さなタイルの中に入れて出す。一覧の行頭や
 * 空の表示で「何の項目か」を目印にする。大きさは sm/md/lg の3段。
 */
export default function IconTile({
  icon: Icon,
  size = 'md',
}: {
  icon: LucideIcon
  /** sm＝22px・md＝28px・lg＝32px（中のアイコンは 11/15/17） */
  size?: 'sm' | 'md' | 'lg'
}) {
  const iconSize = size === 'sm' ? 11 : size === 'lg' ? 17 : 15
  return (
    <span className={[styles.root, styles[size]].join(' ')}>
      <Icon size={iconSize} aria-hidden="true" />
    </span>
  )
}
