'use client'

/*
 * 回答フォームタブ（Q5F2QE の 5.）。その人の回答を新しい順に、1回答＝1枚のカードで。
 * 項目名は回答時点の質問定義（fields の label）で出し、定義に無いキーは
 * 「（現在は使われていない項目）」を添える（FRIEND-24）。
 */
import { ClipboardList } from 'lucide-react'
import Button from '@/components/shared/button'
import ListRange from '@/components/ui/list-range'
import { formatDateTime } from '@/lib/format'
import type { FriendDetailState } from './use-friend-detail'
import styles from './detail.module.css'

const renderValue = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))

export default function FormsTab({ data }: { data: FriendDetailState }) {
  const { submissions, submissionsStatus, submissionsTotal, submissionsNextCursor, submissionsLoadingMore, submissionsMoreError } = data

  if (submissionsStatus === 'loading' || submissionsStatus === 'idle') {
    return <div className={styles.pane}><p className={styles.paneNote}>回答を読み込んでいます…</p></div>
  }
  if (submissionsStatus === 'error') {
    return (
      <div className={`${styles.pane} ${styles.centered}`} role="alert">
        <p className={styles.paneNote}>回答を読み込めませんでした。</p>
        <Button onClick={() => void data.loadSubmissions()}>もう一度読み込む</Button>
      </div>
    )
  }
  if (submissions.length === 0) {
    return <div className={styles.pane}><p className={styles.paneNote}>フォームの回答はまだありません。</p></div>
  }

  return (
    <div className={styles.pane}>
      {typeof submissionsTotal === 'number' && submissionsTotal > submissions.length ? (
        <p className={styles.secNote}><ListRange total={submissionsTotal} first={1} last={submissions.length} /></p>
      ) : null}
      {submissions.map((s) => {
        const named = (s.fields ?? []).filter((f) => f && typeof f.name === 'string' && typeof f.label === 'string')
        const labelByName = new Map(named.map((f) => [f.name, f.label]))
        const keys = named.map((f) => f.name).filter((name) => name in (s.data ?? {}))
        const orphans = Object.keys(s.data ?? {}).filter((k) => !labelByName.has(k))
        return (
          <article key={s.id} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.formIcon}><ClipboardList size={15} aria-hidden /></span>
              <h3 className={styles.cardTitle} title={s.formName}>{s.formName}</h3>
              <span className={styles.time}>{formatDateTime(s.createdAt)}</span>
            </div>
            <dl className={styles.answers}>
              {keys.map((k) => (
                <div key={k} className={styles.answer}><dt>{labelByName.get(k)}</dt><dd>{renderValue(s.data[k])}</dd></div>
              ))}
              {orphans.map((k) => (
                <div key={k} className={styles.answer}>
                  <dt title={`項目キー: ${k}`}>{k}<span className={styles.orphan}>（現在は使われていない項目）</span></dt>
                  <dd>{renderValue(s.data[k])}</dd>
                </div>
              ))}
            </dl>
          </article>
        )
      })}
      {submissionsNextCursor ? (
        <div className={styles.centered}>
          {/* 続きを読めなかったら、その場に黄色の文＋さらに読み込むを残す（絵の注記）。 */}
          {submissionsMoreError ? <p className={styles.warnText} role="alert">続きを読み込めませんでした。</p> : null}
          <Button onClick={() => void data.loadSubmissions(submissionsNextCursor)} disabled={submissionsLoadingMore} busy={submissionsLoadingMore} busyLabel="読み込んでいます…">さらに読み込む</Button>
        </div>
      ) : null}
    </div>
  )
}
