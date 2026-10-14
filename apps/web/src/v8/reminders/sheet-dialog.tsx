'use client'

/** リマインダの確認を共通の窓・注意帯・操作段へ渡す。 */
import { type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import styles from './sheet-dialog.module.css'

export default function SheetDialog({
  open,
  title,
  description,
  band,
  bandTone = 'warning',
  busy = false,
  error,
  destructive,
  actions,
  designNode,
  designWidth = 720,
  designTop,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  /** 説明の下の帯（影響・注意）。 */
  band?: ReactNode
  bandTone?: 'warning' | 'danger'
  busy?: boolean
  error?: string
  /** 左端の危ない操作（削除）。無ければボタンは真ん中に並ぶ。 */
  destructive?: ReactNode
  /** 危ない操作の隣に並べる操作。実行がいちばん右。 */
  actions: ReactNode
  designNode?: string
  designWidth?: number
  designTop?: number
  onClose: () => void
}) {
  return <Dialog open={open} title={title} description={description} onCancel={onClose} busy={busy} error={error} designNode={designNode}
    role={destructive ? 'alertdialog' : undefined} confirmation designLayout="stacked" designWidth={designWidth} designTop={designTop}
    footer={<DialogActions>{destructive}{actions}</DialogActions>} footerAlign={destructive ? 'start' : 'center'}>
    {band ? bandTone === 'danger' ? <Notice tone="danger" appearance="soft" icon={<TriangleAlert size={16} aria-hidden="true" />}>{band}</Notice> : <div className={styles.band} data-tone={bandTone}><TriangleAlert size={16} aria-hidden="true" className={styles.bandIcon} /><div className={styles.bandText}>{band}</div></div> : null}
  </Dialog>
}
