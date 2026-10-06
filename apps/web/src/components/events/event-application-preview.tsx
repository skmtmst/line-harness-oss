'use client'
import { useRef, useState } from 'react'
import type { EventApplicationPreview } from '@line-crm/shared'
import { eventsApi, type EventDetail } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { formatDateTime } from '@/lib/format'
import { jstHHMMToUtcIso } from './jst'

export default function EventApplicationPreviewDialog({ accountId, draft, slot }: {
  accountId: string; draft: EventDetail;
  slot: { date: string; startTime: string; durationMinutes: number; capacity: string }
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  const [data, setData] = useState<EventApplicationPreview | null>(null), [error, setError] = useState('')
  const generation = useRef(0)
  async function load() {
    const seq = ++generation.current
    setOpen(true); setBusy(true); setError(''); setData(null)
    try {
      const starts_at = jstHHMMToUtcIso(slot.date, slot.startTime)
      const result = await eventsApi.applicationPreview(accountId, { ...draft, slot: {
        starts_at, ends_at: new Date(Date.parse(starts_at) + slot.durationMinutes * 60000).toISOString(), capacity: Number(slot.capacity),
      } })
      if (seq === generation.current) setData(result)
    } catch { if (seq === generation.current) setError('見本を開けませんでした。入力を確認して、もう一度お試しください。') }
    finally { if (seq === generation.current) setBusy(false) }
  }
  return <>
    <Button variant="secondary" onClick={() => void load()}>プレビューを開く</Button>
    <Dialog open={open} title="お客さまの申込ページの見本" onCancel={() => { ++generation.current; setOpen(false) }} footer={<Button onClick={() => { ++generation.current; setOpen(false) }}>閉じる</Button>}>
      {busy ? <ListState kind="loading" /> : error ? <ListState kind="error" description={error} action={<Button onClick={() => void load()}>再試行</Button>} /> : data && <div className="space-y-3">
        <p className="font-semibold">{data.name}</p><p>{formatDateTime(data.startsAt)}〜{formatDateTime(data.endsAt)}</p>
        <p>{data.venueName}</p><p>{data.venueAddress}</p>
        {data.venueUrl && <a href={data.venueUrl} target="_blank" rel="noopener noreferrer">会場の案内</a>}
        <p className="whitespace-pre-wrap">{data.description}</p><p>残り {data.capacity} 席</p>
        {data.questions.map((question) => <label key={question.id} className="block">{question.label}{question.required && '（必須）'}<input className="block border border-control-border rounded-control" disabled aria-label={question.label} /></label>)}
        <Button disabled>{data.requiresApproval ? '申し込む（承認後に確定）' : '申し込む'}</Button>
        <p className="text-xs text-ink-faint">見本です。申し込みや公開は行いません。</p>
      </div>}
    </Dialog>
  </>
}
