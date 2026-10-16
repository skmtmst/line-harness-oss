'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import { notifySaved } from '@/components/shared/toast'
import { gapDraftApi, type BookingGroup } from '@/lib/api-gap-draft'
import { isNotReadyError } from '@/lib/api-booking-payment-admin'
import { formatTime } from '@/lib/format'
import styles from './booking-charges.module.css'

/*
 * 予約の詳細の「この組」（B5・絵 Nx1kq）：同じ申込で入った人ごとの予約と［組をまとめて取り消す］。
 * 口は案（api-gap-draft の組：口が要る）。口が無い・組でない予約は段を出さない。
 */
export function BookingGroupSection({ accountId, bookingId, canOperate, onChanged }: { accountId: string; bookingId: string; canOperate: boolean; onChanged?: () => void }) {
  const [group, setGroup] = useState<BookingGroup | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.resolve().then(() => gapDraftApi.bookingGroup(accountId, bookingId)).then((response) => { if (alive) setGroup(response.data) }).catch(() => { if (alive) setGroup(null) })
    return () => { alive = false }
  }, [accountId, bookingId])
  if (!group || group.members.length < 2) return null
  async function cancelAll() {
    setBusy(true); setError(null)
    try {
      const response = await gapDraftApi.cancelGroup(accountId, bookingId, reason.trim())
      notifySaved(`${response.data.cancelled} 件の予約を取り消しました`)
      setOpen(false)
      onChanged?.()
    } catch (cause) {
      setError(isNotReadyError(cause) ? 'データの準備が済むと、組をまとめて取り消せます。' : '取り消せませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={`${styles.section} ${styles.groupSection}`} aria-label="この組">
      <div className={styles.headRow}><h3 className={styles.title}>{`この組（${group.members.length} 人）`}</h3>{group.ownerName ? <span className={styles.minor}>{`${group.ownerName} さまの予約`}</span> : null}</div>
      <div className={styles.groupTable} role="table" aria-label="この組の予約">
        <div className={`${styles.groupRow} ${styles.groupHead}`} role="row"><span role="columnheader">人</span><span role="columnheader">メニュー</span><span role="columnheader">担当</span><span role="columnheader">時間</span></div>
        {group.members.map((member) => (
          <div key={member.bookingId} className={styles.groupRow} role="row">
            <span role="cell" title={member.personName}>{member.personName}</span>
            <span role="cell" className={styles.groupWrap}>{member.menuName}</span>
            <span role="cell">{member.staffName ?? '—'}</span>
            <span role="cell">{`${formatTime(member.startsAt)}〜${formatTime(member.endsAt)}`}</span>
          </div>
        ))}
      </div>
      {canOperate ? <div className={styles.actions}><Button variant="danger" onClick={() => { setReason(''); setError(null); setOpen(true) }}>組をまとめて取り消す</Button></div> : null}
      <Dialog open={open} title="組をまとめて取り消しますか？" titleNote={`${group.members.length} 件の予約をまとめて取り消します`} size="small" contentLayout="form" tone="destructive"
        busy={busy} error={error ?? undefined} cancelLabel="やめる" onCancel={() => { if (!busy) setOpen(false) }}
        confirmLabel="まとめて取り消す" confirmDisabled={!reason.trim()} confirmDisabledReason="理由を入れてください" onConfirm={() => void cancelAll()}>
        <Field label="取り消す理由" required><TextField aria-label="取り消す理由" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></Field>
        <p className={styles.minor}>取り消すと元に戻せません。お客さまへの知らせは予約ごとの決まりのとおりです。</p>
      </Dialog>
    </section>
  )
}
