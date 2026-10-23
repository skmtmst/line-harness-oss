'use client'

import CopyTextButton from './copy-text-button'
import Dialog from './dialog'
import { formatDate } from '@/lib/format'
import styles from './log-entry-details.module.css'

/** 本文・URL・鍵・生のエラーを渡さず、表示用の記録だけを扱う。 */
export type LogEntryFacts = { occurredAt: string; target: string; status: string; reason: string }

function facts(entry: LogEntryFacts) {
  return [
    ['時刻', formatDate(entry.occurredAt, { style: 'detail', fallback: '日時不明' })],
    ['相手', entry.target], ['結果', entry.status], ['理由', entry.reason],
  ]
}

export function LogEntryCopy({ entry, canCopy = false }: { entry: LogEntryFacts; canCopy: boolean | undefined }) {
  if (!canCopy) return null
  return <CopyTextButton value={facts(entry).map(([label, value]) => `${label}：${value}`).join('\n')} aria-label="この記録をコピー" feedbackDurationMs={1600} />
}

export default function LogEntryDetails({ entry, onClose, canCopy = false }: { entry: LogEntryFacts | null; onClose: () => void; canCopy: boolean | undefined }) {
  return <Dialog open={entry !== null} title="実行記録の中身" onCancel={onClose} cancelLabel="閉じる">
    {entry ? <div className={styles.body}>
      <dl className={styles.facts}>{facts(entry).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <LogEntryCopy entry={entry} canCopy={canCopy} />
    </div> : null}
  </Dialog>
}
