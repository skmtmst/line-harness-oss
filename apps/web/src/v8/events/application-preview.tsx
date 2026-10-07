'use client'

/*
 * 「プレビューを開く →」：お客さまの申込ページの見本を窓で見せる（絵 d4adD4 の右の列）。
 * 口は今の作り（components/events/event-application-preview.tsx）と同じ applicationPreview。
 * 見本を作るだけで、申し込みや公開はしない。
 */
import { useRef, useState } from 'react'
import type { EventApplicationPreview } from '@line-crm/shared'
import { eventsApi, type EventDetail } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { jstToUtcIso } from './shared'
import styles from './create.module.css'

export default function ApplicationPreview({ accountId, draft, date, startTime, endTime, capacity }: {
  accountId: string
  draft: EventDetail
  date: string
  startTime: string
  endTime: string
  capacity: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<EventApplicationPreview | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)

  async function load() {
    const seq = ++generation.current
    setOpen(true)
    setBusy(true)
    setError('')
    setData(null)
    try {
      const result = await eventsApi.applicationPreview(accountId, {
        ...draft,
        slot: { starts_at: jstToUtcIso(date, startTime), ends_at: jstToUtcIso(date, endTime), capacity: Number(capacity) || 1 },
      })
      if (seq === generation.current) setData(result)
    } catch {
      if (seq === generation.current) setError('見本を開けませんでした。入力を確かめて、もう一度お試しください。')
    } finally {
      if (seq === generation.current) setBusy(false)
    }
  }
  const close = () => {
    ++generation.current
    setOpen(false)
  }

  return (
    <div className={styles.linkRow}>
      <button type="button" className={styles.linkButton} onClick={() => void load()}>プレビューを開く →</button>
      <Dialog open={open} title="お客さまの申込ページの見本" onCancel={close} footer={<Button onClick={close}>閉じる</Button>}>
        {busy ? <ListState kind="loading" /> : error ? (
          <ListState kind="error" description={error} action={<Button onClick={() => void load()}>もう一度試す</Button>} />
        ) : data ? (
          <div className={styles.previewBody}>
            <p className={styles.phoneName}>{data.name}</p>
            <p>{formatDateTime(data.startsAt)}〜{formatDateTime(data.endsAt)}</p>
            {data.venueName ? <p>{data.venueName}</p> : null}
            {data.venueAddress ? <p>{data.venueAddress}</p> : null}
            {data.description ? <p className={styles.previewText}>{data.description}</p> : null}
            <p>残り {data.capacity} 席</p>
            {data.questions.map((question) => (
              <label key={question.id} className={styles.previewQuestion}>
                {question.label}{question.required ? '（必須）' : ''}
                <input className={styles.input} disabled aria-label={question.label} />
              </label>
            ))}
            <Button disabled>{data.requiresApproval ? '申し込む（承認後に確定）' : '申し込む'}</Button>
            <p className={styles.cardNote}>見本です。申し込みや公開は行いません。</p>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
