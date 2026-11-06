'use client'

import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu as SharedRowMenu } from '@/components/shared/row-actions'
import styles from './row-menu.module.css'

/**
 * 統括の一括配信の表の行末「…」（絵 p17Qku・xOXuY）。枠のある 36 の四角＝共通の RowMenu（appearance=box）。
 * 押すと共通の操作メニュー。読み上げ名は「〇〇のその他操作」（今までの RowActions と同じ）。
 */
export default function RowMenu({ subjectName, items }: { subjectName: string; items: ActionMenuItem[] }) {
  return (
    <span className={styles.rowMenu}>
      <SharedRowMenu label={`${subjectName}のその他操作`} menuLabel={`${subjectName}の操作`} items={items} />
    </span>
  )
}
