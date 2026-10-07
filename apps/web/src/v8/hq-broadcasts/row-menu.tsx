'use client'

import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import IconButton from '@/components/shared/icon-button'
import styles from './row-menu.module.css'

/**
 * 統括の一括配信の表の行末「…」（絵 p17Qku・xOXuY）。枠のある 36 の四角＝共通のアイコンボタン。
 * 押すと共通の操作メニュー。読み上げ名は「〇〇のその他操作」（今までの RowActions と同じ）。
 */
export default function RowMenu({ subjectName, items }: { subjectName: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={styles.rowMenu}>
      <IconButton aria-label={`${subjectName}のその他操作`} title={`${subjectName}のその他操作`} aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current) }}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </IconButton>
      <ActionMenu open={open} onClose={() => setOpen(false)} ariaLabel={`${subjectName}の操作`} items={items} />
    </span>
  )
}
