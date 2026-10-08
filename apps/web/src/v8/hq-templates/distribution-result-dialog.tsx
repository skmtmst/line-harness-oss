'use client'

import { RotateCw } from 'lucide-react'
import type { DistributionResult } from '@/lib/hq-templates-api'
import Dialog from '@/components/shared/dialog'
import StatusBadge from '@/components/shared/status-badge'
import { failedStatus } from './folder-distribution'
import styles from './console.module.css'

export function resultSentence(store: DistributionResult['stores'][number]): string {
  if (store.status !== 'succeeded') return '配っています'
  if (store.counts.aliased > 0) return store.createdName ? `同じ名前があったため「${store.createdName}」で作りました` : '同じ名前があったため、別名で作りました'
  if (store.counts.overwritten > 0) return '上書きしました'
  if (store.counts.created > 0) return '新しく作りました'
  if ((store.counts.reused ?? 0) > 0) return '今あるものを使いました'
  return '配りました'
}
export default function DistributionResultDialog({ open, title, summary, rows, busy, onClose, onRetry }: {
  open: boolean; title: string; summary: string
  rows: Array<{ key: string; name: string; store: DistributionResult['stores'][number] }>
  busy: boolean; onClose: () => void; onRetry: () => void
}) {
  const failures = rows.filter((row) => failedStatus(row.store.status))
  return <Dialog open={open} designNode="dEvJM" designWidth={640} designTop={220} title={title} designHeaderPadding="24px 24px 0"
    busy={busy} cancelLabel="閉じる" onCancel={onClose}
    {...(failures.length ? { confirmLabel: `失敗した ${failures.length} 件をやり直す`, confirmIcon: <RotateCw size={15} />,
      onConfirm: onRetry } : {})}>
    <p className={styles.resultSummary}>{summary}</p>
    <div className={styles.resultList}>
      {rows.map(({ key, name, store }) => {
        const failed = failedStatus(store.status)
        return <div key={key} className={styles.resultRow}>
          <span className={styles.resultName} title={name}>{name}</span>
          <span className={styles.resultText}>{failed ? (store.reason || '配布できませんでした。アカウントの現在版を再確認してください。') : resultSentence(store)}</span>
          <StatusBadge size="compact" tone={store.status === 'succeeded' ? 'success' : failed ? 'danger' : 'neutral'}>{store.status === 'succeeded' ? '成功' : failed ? '失敗' : '作成中'}</StatusBadge>
        </div>
      })}
    </div>
    {failures.length ? <p className={styles.resultBand}>{`失敗した ${failures.length} 件だけやり直せます。各行の理由を直してから、やり直してください。`}</p> : null}
  </Dialog>
}
