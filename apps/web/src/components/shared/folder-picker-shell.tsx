'use client'
import type { ReactNode } from 'react'
import Dialog from './dialog'
import FolderPanel, { type FolderPanelRow } from './folder-panel'
import styles from './folder-picker-shell.module.css'

/** B-165：受信箱とタグ選びが同じ640pxの窓を使う。 */
export default function FolderPickerShell({ title, onClose, rows, activeId, onFolder, search, children, footer, beforeFooter, sideNote, busy = false }: {
  title: string; onClose: () => void; rows: FolderPanelRow[]; activeId: string; onFolder: (id: string) => void
  search: ReactNode; children: ReactNode; footer: ReactNode; beforeFooter?: ReactNode; sideNote?: ReactNode; busy?: boolean
}) {
  return <Dialog open busy={busy} onCancel={onClose} title={title} designWidth={640} designHeaderPadding="var(--tpl-inbox-tp-head-pad)" footer={<>
    <div className={styles.body}>
      <div className={styles.side}><FolderPanel readOnly rows={rows} activeId={activeId} onSelect={onFolder} />{sideNote}</div>
      <div className={styles.list}>{search}{children}</div>
    </div>
    {beforeFooter}
    <div className={styles.foot}>{footer}</div>
  </>} />
}
