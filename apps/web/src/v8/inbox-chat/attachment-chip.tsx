'use client'

/*
 * ★V8 書く欄の上の添付の札（M0393「7. 添付」：選ぶと書く欄の上に札（名前・大きさ・×）で並ぶ）。
 * 動画・ファイルの準備（アップロード）の途中・失敗もこの札で見せる。
 * 失敗は理由と［もう一度試す］。送っている間は × を押せない。
 */
import { FileText, Film, RotateCw, X } from 'lucide-react'
import { formatSize } from './attachments'
import styles from './inbox-chat.module.css'

export type PendingAttachmentView = {
  kind: 'video' | 'file'
  name: string
  size: number
  status: 'uploading' | 'ready' | 'failed'
  error?: string
}

export default function AttachmentChip({
  item,
  busy,
  onRemove,
  onRetry,
}: {
  item: PendingAttachmentView
  /** 送っている間（× を押せない）。 */
  busy?: boolean
  onRemove: () => void
  onRetry: () => void
}) {
  const Icon = item.kind === 'video' ? Film : FileText
  const sub = item.status === 'uploading'
    ? `${formatSize(item.size)}・準備しています…`
    : item.status === 'failed'
      ? item.error ?? '準備できませんでした'
      : item.kind === 'file'
        ? `${formatSize(item.size)}・期限30日のリンクで届く`
        : formatSize(item.size)
  return (
    <div
      className={styles.attachChip}
      data-inbox-v8="attachment-chip"
      data-status={item.status}
      aria-busy={item.status === 'uploading' || undefined}
    >
      <Icon aria-hidden className={styles.attachChipIcon} />
      <span className={styles.attachChipText}>
        <span className={styles.attachChipName} title={item.name}>{item.name}</span>
        <span className={item.status === 'failed' ? styles.attachChipError : styles.attachChipSub} role={item.status === 'failed' ? 'alert' : undefined} title={sub}>
          {sub}
        </span>
      </span>
      {item.status === 'failed' ? (
        <button type="button" className={styles.attachChipRetry} onClick={onRetry}>
          <RotateCw aria-hidden className={styles.attachChipRetryIcon} />
          もう一度試す
        </button>
      ) : null}
      <button
        type="button"
        className={styles.attachChipRemove}
        aria-label={`「${item.name}」を外す`}
        title="外す"
        disabled={busy}
        onClick={onRemove}
      >
        <X aria-hidden className={styles.attachChipRemoveIcon} />
      </button>
    </div>
  )
}
