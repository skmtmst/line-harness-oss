'use client'

/*
 * ★V8 予約台帳の窓：予約の変更（取消・復活・押さえの解除もここ）・取消の確認・受信データの試し。
 * 送る形は今の画面（app/restaurant-test/v8/reservations.tsx）と同じ。
 */
import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import type { RestaurantMenuItem, RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'
import { DialogField, DialogNote, RsDialog } from '../booking-kit/parts'
import { INACTIVE_STATUSES, hm, isHold, pad2 } from './format'
import styles from './reservations.module.css'

function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export type ReservationPatch = Record<string, unknown>

export function EditReservationDialog({ reservation, tables, courses, busy, canWrite, onClose, onSave, onCancelReservation, onRestore }: {
  reservation: RestaurantReservation | null
  tables: RestaurantTable[]
  courses: RestaurantMenuItem[]
  busy: boolean
  canWrite: boolean
  onClose: () => void
  onSave: (patch: ReservationPatch) => void
  onCancelReservation: (id: string) => void
  onRestore: (id: string) => void
}) {
  const [draft, setDraft] = useState({ customerName: '', customerPhone: '', guestCount: '2', allergyNote: '', startsAt: '', endsAt: '', tableId: '', courseId: '' })
  useEffect(() => {
    if (!reservation) return
    setDraft({
      customerName: reservation.customer_name,
      customerPhone: reservation.customer_phone || '',
      guestCount: String(reservation.guest_count),
      allergyNote: reservation.allergy_note || '',
      startsAt: toLocalInput(reservation.starts_at),
      endsAt: toLocalInput(reservation.ends_at),
      tableId: reservation.table_id || '',
      courseId: reservation.course_id || '',
    })
  }, [reservation])
  if (!reservation) return null
  const hold = isHold(reservation)
  const inactive = INACTIVE_STATUSES.includes(reservation.status)
  const save = () => onSave({
    customerName: draft.customerName,
    customerPhone: draft.customerPhone || null,
    guestCount: Number(draft.guestCount),
    startsAt: new Date(draft.startsAt).toISOString(),
    endsAt: new Date(draft.endsAt).toISOString(),
    tableId: draft.tableId || null,
    courseId: draft.courseId || null,
    allergyNote: draft.allergyNote || null,
  })
  return (
    <RsDialog
      open
      title={hold ? `押さえ（${hm(reservation.starts_at)}〜${hm(reservation.ends_at)}）` : `${reservation.customer_name}さんの予約`}
      width={600}
      top={120}
      busy={busy}
      onCancel={onClose}
      onSubmit={canWrite && !hold ? save : undefined}
      actions={(
        <>
          {canWrite ? (
            hold ? (
              <Button type="button" variant="danger" className={styles.dialogLeft} disabled={busy} onClick={() => onCancelReservation(reservation.id)}>押さえを解除</Button>
            ) : inactive ? (
              <Button type="button" className={styles.dialogLeft} disabled={busy} onClick={() => onRestore(reservation.id)}>予約を有効に戻す</Button>
            ) : (
              <Button type="button" className={`${styles.dialogLeft} ${styles.dangerText}`} disabled={busy} onClick={() => onCancelReservation(reservation.id)}>予約を取り消す</Button>
            )
          ) : null}
          <Button type="button" onClick={onClose} disabled={busy}>{canWrite && !hold ? 'キャンセル' : '閉じる'}</Button>
          {canWrite && !hold ? <Button type="submit" variant="primary" disabled={busy || !draft.customerName.trim()}>保存する</Button> : null}
        </>
      )}
    >
      {hold ? (
        <DialogNote>{`${reservation.note || '仮押さえ'}・解除の期限 ${reservation.hold_expires_at ? hm(reservation.hold_expires_at) : '—'}。期限を過ぎると空き卓に戻ります。台帳には履歴が残ります。`}</DialogNote>
      ) : (
        <>
          <div className={styles.pair}>
            <DialogField label="お客様名" htmlFor="rs-edit-name">
              <TextField id="rs-edit-name" required disabled={!canWrite} value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} />
            </DialogField>
            <DialogField label="電話番号" htmlFor="rs-edit-phone">
              <TextField id="rs-edit-phone" disabled={!canWrite} value={draft.customerPhone} onChange={(event) => setDraft({ ...draft, customerPhone: event.target.value })} />
            </DialogField>
          </div>
          <div className={styles.pair}>
            <DialogField label="人数" htmlFor="rs-edit-guests">
              <TextField id="rs-edit-guests" type="number" min={1} max={100} required disabled={!canWrite} value={draft.guestCount} onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })} />
            </DialogField>
            <DialogField label="アレルギー・特記事項" htmlFor="rs-edit-allergy">
              <TextField id="rs-edit-allergy" disabled={!canWrite} value={draft.allergyNote} onChange={(event) => setDraft({ ...draft, allergyNote: event.target.value })} />
            </DialogField>
          </div>
          <div className={styles.pair}>
            <DialogField label="開始日時" htmlFor="rs-edit-start">
              <TextField id="rs-edit-start" type="datetime-local" required disabled={!canWrite} value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} />
            </DialogField>
            <DialogField label="終了日時" htmlFor="rs-edit-end">
              <TextField id="rs-edit-end" type="datetime-local" required disabled={!canWrite} value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} />
            </DialogField>
          </div>
          <div className={styles.pair}>
            <DialogField label="卓" kind="select">
              <Select aria-label="卓" size="full" disabled={!canWrite} value={draft.tableId} onChange={(value) => setDraft({ ...draft, tableId: value })} options={[
                { value: '', label: '未配席' },
                ...tables.filter((table) => table.is_active || table.id === reservation.table_id).map((table) => ({ value: table.id, label: `${table.code}・${table.label}（${table.min_capacity}〜${table.max_capacity}名）` })),
              ]} />
            </DialogField>
            <DialogField label="コース" kind="select">
              <Select aria-label="コース" size="full" disabled={!canWrite} value={draft.courseId} onChange={(value) => setDraft({ ...draft, courseId: value })} options={[
                { value: '', label: '席のみ' },
                ...courses.filter((course) => course.status === 'active' || course.id === reservation.course_id).map((course) => ({ value: course.id, label: course.name })),
              ]} />
            </DialogField>
          </div>
          <DialogNote>予約媒体から受けた予約は、予約媒体へは書き戻しません（検証環境は受信専用）。卓を変えると、同じ時間に重なる予約がないかを確かめてから保存します。</DialogNote>
        </>
      )}
    </RsDialog>
  )
}

export function CancelReservationDialog({ reservation, busy, onClose, onConfirm }: {
  reservation: RestaurantReservation | null
  busy: boolean
  onClose: () => void
  onConfirm: (id: string) => void
}) {
  const hold = reservation ? isHold(reservation) : false
  return (
    <RsDialog
      open={Boolean(reservation)}
      title={hold ? 'この押さえを解除しますか？' : 'この予約を取り消しますか？'}
      width={480}
      top={240}
      busy={busy}
      onCancel={onClose}
      actions={(
        <>
          <Button onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button variant="danger" disabled={busy} onClick={() => { if (reservation) onConfirm(reservation.id) }}>{hold ? '解除する' : '取り消す'}</Button>
        </>
      )}
    >
      {reservation ? <p className={styles.dialogStrong}>{hold ? `押さえ ${hm(reservation.starts_at)}〜${hm(reservation.ends_at)}` : `${reservation.customer_name}・${reservation.guest_count}名・${hm(reservation.starts_at)}`}</p> : null}
      <DialogNote>台帳には取消として残ります。時間帯の在庫は人数分だけ戻ります。</DialogNote>
    </RsDialog>
  )
}

export function InboundTrialDialog({ open, busy, onClose, onSubmit }: {
  open: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (body: { provider: string; externalId: string; customerName: string; guestCount: number; startsAt: string }) => void
}) {
  const [draft, setDraft] = useState({ provider: 'restaurant_board', externalId: '', customerName: '', guestCount: '2', startsAt: '' })
  useEffect(() => { if (open) setDraft({ provider: 'restaurant_board', externalId: `DEMO-${Date.now()}`, customerName: '', guestCount: '2', startsAt: '' }) }, [open])
  return (
    <RsDialog
      open={open}
      title="受信データを試す"
      width={560}
      top={160}
      busy={busy}
      designNode="l4qsT"
      onCancel={onClose}
      onSubmit={() => {
        if (!draft.customerName.trim() || !draft.startsAt) return
        onSubmit({ provider: draft.provider, externalId: draft.externalId, customerName: draft.customerName.trim(), guestCount: Number(draft.guestCount), startsAt: new Date(draft.startsAt).toISOString() })
      }}
      actions={(
        <>
          <Button type="button" onClick={onClose} disabled={busy}>閉じる</Button>
          <Button type="submit" variant="primary" disabled={busy || !draft.customerName.trim() || !draft.startsAt}>受信として取り込む</Button>
        </>
      )}
    >
      <div className={styles.pair}>
        <DialogField label="受信元" kind="select">
          <Select aria-label="受信元" size="full" value={draft.provider} onChange={(value) => setDraft({ ...draft, provider: value })} options={[
            { value: 'restaurant_board', label: 'レストランボード' },
            { value: 'hotpepper', label: 'Hot Pepper' },
            { value: 'tabelog', label: '食べログ' },
          ]} />
        </DialogField>
        <DialogField label="外部予約ID" htmlFor="rs-trial-id">
          <TextField id="rs-trial-id" required value={draft.externalId} onChange={(event) => setDraft({ ...draft, externalId: event.target.value })} />
        </DialogField>
      </div>
      <DialogField label="お客様名" htmlFor="rs-trial-name">
        <TextField id="rs-trial-name" required value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} />
      </DialogField>
      <div className={styles.pair}>
        <DialogField label="人数" htmlFor="rs-trial-guests">
          <TextField id="rs-trial-guests" type="number" min={1} max={100} required value={draft.guestCount} onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })} />
        </DialogField>
        <DialogField label="開始日時" htmlFor="rs-trial-start">
          <TextField id="rs-trial-start" type="datetime-local" required value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} />
        </DialogField>
      </div>
      <DialogNote>受信専用のデータとして台帳に取り込みます。予約媒体へは書き戻しません。滞在は2時間で入れます。</DialogNote>
    </RsDialog>
  )
}
