'use client'

/*
 * ★V8 リマインダの確かめる窓（Pencil `RwVo5` 一時停止・`VsSyu` 削除）。
 *
 * 共通の Dialog（q3DPdz：頭・中身・下を別の段、幅560）とは形が違う
 * （幅600・上から260・1枚の面に 題→説明→帯→ボタン を間14で積む・下に線なし）ため、
 * 面はここで組む（リッチメニューの yOyCg と同じ作り）。フォーカスの移動・Esc・
 * 背景を止めるのは共通の useOverlayFocus。
 */
import { type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
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
  /** 左端に離して置く危ない操作（削除）。無ければボタンは真ん中に並ぶ。 */
  destructive?: ReactNode
  /** 真ん中に並べる操作。実行がいちばん右。 */
  actions: ReactNode
  designNode?: string
  onClose: () => void
}) {
  return <Dialog open={open} title={title} description={description} onCancel={onClose} busy={busy} error={error} designNode={designNode}
    tone={destructive ? 'destructive' : 'default'} confirmation designLayout="stacked" designWidth={720}
    footer={<>{destructive}{actions}</>} footerAlign="center">
    {band ? <div className={styles.band} data-tone={bandTone}><TriangleAlert size={16} aria-hidden="true" className={styles.bandIcon} /><div className={styles.bandText}>{band}</div></div> : null}
  </Dialog>
}
