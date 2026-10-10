'use client'

/*
 * ★V8 予約台帳の窓：予約の変更（取消・復活・押さえの解除もここ）・取消の確認・受信データの試し。
 * 送る形は今の画面（app/restaurant-test/v8/reservations.tsx）と同じ。
 */
import { useEffect, useState } from 'react'
import { Field } from '@/components/shared/form-controls'
import { useFormErrors } from '@/lib/use-form-errors'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import DateTimeField from '@/components/shared/date-time-field'
import type { RestaurantMenuItem, RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'
import { DialogNote, RsDialog } from '../booking-kit/parts'
import { INACTIVE_STATUSES, hm, isHold, pad2 } from './format'
import styles from './reservations.module.css'
import { SaveErrorField } from '@/components/shared/save-form-errors'

function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 「10/2（金）」の形（取消の確認の1行目）。 */
function monthDayWeek(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}（${'日月火水木金土'[date.getDay()]}）`
}

export type ReservationPatch = Record<string, unknown>

/** 閲覧のみ：選ぶ部品は置かず、選んでいる値を読み取りだけの欄で見せる（2026-10-06 オーナー決定）。 */
function ReadOnlyChoice({ label, value, options }: { label: string; value: string; options: Array<{ value: string; label: string }> }) {
  const shown = options.find((option) => option.value === value)?.label ?? value
  return <SaveErrorField names={["shown"]}><TextField aria-label={label} value={shown} readOnly aria-readonly="true" title={shown} /></SaveErrorField>
}

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
  const fields = useFormErrors()
  fields.define('name', 'お客様名', () => draft.customerName.trim() ? null : 'お客様名を入れてください。')
  fields.define('count', '人数', () => Number.isInteger(Number(draft.guestCount)) && Number(draft.guestCount) >= 1 && Number(draft.guestCount) <= 100 ? null : '人数は1〜100で入れてください。')
  fields.define('start', '開始日時', () => Number.isFinite(Date.parse(draft.startsAt)) ? null : '開始日時を選んでください。')
  fields.define('end', '終了日時', () => Number.isFinite(Date.parse(draft.endsAt)) && Date.parse(draft.endsAt) > Date.parse(draft.startsAt) ? null : '終了日時は開始日時より後にしてください。')
  if (!reservation) return null
  const hold = isHold(reservation)
  const inactive = INACTIVE_STATUSES.includes(reservation.status)
  const save = () => {
    if (fields.submit().length > 0) {
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')
        target?.focus(); target?.scrollIntoView({ block: 'center' })
      })
      return
    }
    onSave({
    customerName: draft.customerName,
    customerPhone: draft.customerPhone || null,
    guestCount: Number(draft.guestCount),
    startsAt: new Date(draft.startsAt).toISOString(),
    endsAt: new Date(draft.endsAt).toISOString(),
    tableId: draft.tableId || null,
    courseId: draft.courseId || null,
    allergyNote: draft.allergyNote || null,
    })
  }
  const tableOptions = [
    { value: '', label: '未配席' },
    ...tables.filter((table) => table.is_active || table.id === reservation.table_id).map((table) => ({ value: table.id, label: `${table.code}・${table.label}（${table.min_capacity}〜${table.max_capacity}名）` })),
  ]
  const courseOptions = [
    { value: '', label: '席のみ' },
    ...courses.filter((course) => course.status === 'active' || course.id === reservation.course_id).map((course) => ({ value: course.id, label: `${course.name} ${course.price.toLocaleString()}円` })),
  ]
  return (
    <RsDialog
      noValidate
      open
      title={hold ? `押さえ（${hm(reservation.starts_at)}〜${hm(reservation.ends_at)}）` : `${reservation.customer_name}さんの予約${canWrite ? 'を変更' : ''}`}
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
              <Button type="button" className={styles.dialogLeft} variant="danger-outline" disabled={busy} onClick={() => onCancelReservation(reservation.id)}>予約を取り消す</Button>
            )
          ) : null}
          <Button type="button" onClick={onClose} disabled={busy}>{canWrite && !hold ? 'キャンセル' : '閉じる'}</Button>
          {canWrite && !hold ? <Button type="submit" variant="primary" disabled={busy}>保存する</Button> : null}
        </>
      )}
    >
      {hold ? (
        <DialogNote>{`${reservation.note || '仮押さえ'}・解除の期限 ${reservation.hold_expires_at ? hm(reservation.hold_expires_at) : '—'}。期限を過ぎると空き卓に戻ります。台帳には履歴が残ります。`}</DialogNote>
      ) : (
        <>
          <div className={styles.pair}>
            <Field label="お客様名" htmlFor="rs-edit-name" error={fields.error('name')}>
              <SaveErrorField names={["customerName","draft.customerName","customer_name","draft.customer_name"]}><TextField id="rs-edit-name" invalid={fields.invalid('name')} required readOnly={!canWrite} value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} /></SaveErrorField>
            </Field>
            <Field label="電話番号" htmlFor="rs-edit-phone">
              <SaveErrorField names={["customerPhone","draft.customerPhone","customer_phone","draft.customer_phone"]}><TextField id="rs-edit-phone" readOnly={!canWrite} value={draft.customerPhone} onChange={(event) => setDraft({ ...draft, customerPhone: event.target.value })} /></SaveErrorField>
            </Field>
          </div>
          <div className={styles.pair}>
            <Field label="人数" htmlFor="rs-edit-guests" error={fields.error('count')}>
              <SaveErrorField names={["guestCount","draft.guestCount","guest_count","draft.guest_count"]}><TextField id="rs-edit-guests" invalid={fields.invalid('count')} type="number" min={1} max={100} required readOnly={!canWrite} value={draft.guestCount} onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })} /></SaveErrorField>
            </Field>
            <Field labelSize="compact" label="卓">
              {canWrite ? (
                <SaveErrorField names={["tableId","draft.tableId","table_id","draft.table_id"]}><Select aria-label="卓" size="full" value={draft.tableId} onChange={(value) => setDraft({ ...draft, tableId: value })} options={tableOptions} /></SaveErrorField>
              ) : <ReadOnlyChoice label="卓" value={draft.tableId} options={tableOptions} />}
            </Field>
          </div>
          <div className={styles.pair}>
            <Field label="開始日時" htmlFor="rs-edit-start" error={fields.error('start')}>
              <SaveErrorField names={["startsAt","draft.startsAt","starts_at","draft.starts_at"]}><DateTimeField id="rs-edit-start" invalid={fields.invalid('start')} required readOnly={!canWrite} value={draft.startsAt} onChange={(next) => setDraft({ ...draft, startsAt: next })} /></SaveErrorField>
            </Field>
            <Field label="終了日時" htmlFor="rs-edit-end" error={fields.error('end')}>
              <SaveErrorField names={["endsAt","draft.endsAt","ends_at","draft.ends_at"]}><DateTimeField id="rs-edit-end" invalid={fields.invalid('end')} required readOnly={!canWrite} value={draft.endsAt} onChange={(next) => setDraft({ ...draft, endsAt: next })} /></SaveErrorField>
            </Field>
          </div>
          <Field labelSize="compact" label="コース">
            {canWrite ? (
              <SaveErrorField names={["courseId","draft.courseId","course_id","draft.course_id"]}><Select aria-label="コース" size="full" value={draft.courseId} onChange={(value) => setDraft({ ...draft, courseId: value })} options={courseOptions} /></SaveErrorField>
            ) : <ReadOnlyChoice label="コース" value={draft.courseId} options={courseOptions} />}
          </Field>
          <Field label="アレルギー・特記事項" htmlFor="rs-edit-allergy">
            <SaveErrorField names={["allergyNote","draft.allergyNote","allergy_note","draft.allergy_note"]}><TextField id="rs-edit-allergy" readOnly={!canWrite} value={draft.allergyNote} onChange={(event) => setDraft({ ...draft, allergyNote: event.target.value })} /></SaveErrorField>
          </Field>
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
      noValidate
      open={Boolean(reservation)}
      title={hold ? 'この押さえを解除しますか？' : 'この予約を取り消しますか？'}
      width={480}
      top={300}
      busy={busy}
      onCancel={onClose}
      actions={(
        <>
          <Button onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button variant="danger" disabled={busy} onClick={() => { if (reservation) onConfirm(reservation.id) }}>{hold ? '解除する' : '取り消す'}</Button>
        </>
      )}
    >
      {reservation ? <p className={styles.dialogStrong}>{hold ? `押さえ ${hm(reservation.starts_at)}〜${hm(reservation.ends_at)}` : `${monthDayWeek(reservation.starts_at)} ${hm(reservation.starts_at)} ${reservation.customer_name}さん ${reservation.guest_count}名`}</p> : null}
      <DialogNote>{hold ? '押さえを解除すると、その時間の卓は空きに戻ります。台帳には履歴が残ります。' : '台帳には取消として残ります。その時間帯の卓は空きに戻ります。取り消した予約は「復活」で戻せます。'}</DialogNote>
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
  const fields = useFormErrors()
  fields.define('externalId', '外部予約ID', () => draft.externalId.trim() ? null : '外部予約IDを入れてください。')
  fields.define('name', 'お客様名', () => draft.customerName.trim() ? null : 'お客様名を入れてください。')
  fields.define('count', '人数', () => Number.isInteger(Number(draft.guestCount)) && Number(draft.guestCount) >= 1 && Number(draft.guestCount) <= 100 ? null : '人数は1〜100で入れてください。')
  fields.define('start', '開始日時', () => Number.isFinite(Date.parse(draft.startsAt)) ? null : '開始日時を選んでください。')
  useEffect(() => { if (open) setDraft({ provider: 'restaurant_board', externalId: `DEMO-${Date.now()}`, customerName: '', guestCount: '2', startsAt: '' }) }, [open])
  return (
    <RsDialog
      noValidate
      open={open}
      title="媒体受信シミュレーター（外部への書戻しなし）"
      width={560}
      top={160}
      busy={busy}
      designNode="l4qsT"
      onCancel={onClose}
      onSubmit={() => {
        if (fields.submit().length > 0) {
          requestAnimationFrame(() => {
            const target = document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')
            target?.focus(); target?.scrollIntoView({ block: 'center' })
          })
          return
        }
        onSubmit({ provider: draft.provider, externalId: draft.externalId, customerName: draft.customerName.trim(), guestCount: Number(draft.guestCount), startsAt: new Date(draft.startsAt).toISOString() })
      }}
      actions={(
        <>
          <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="submit" variant="primary" disabled={busy}>受信として取り込む</Button>
        </>
      )}
    >
      <Field labelSize="compact" label="受信元">
        <SaveErrorField names={["provider","draft.provider"]}><Select aria-label="受信元" size="full" value={draft.provider} onChange={(value) => setDraft({ ...draft, provider: value })} options={[
          { value: 'restaurant_board', label: 'レストランボード' },
          { value: 'hotpepper', label: 'Hot Pepper' },
          { value: 'tabelog', label: '食べログ' },
        ]} /></SaveErrorField>
      </Field>
      <Field label="外部予約ID" htmlFor="rs-trial-id" error={fields.error('externalId')}>
        <SaveErrorField names={["externalId","draft.externalId","external_id","draft.external_id"]}><TextField id="rs-trial-id" invalid={fields.invalid('externalId')} required value={draft.externalId} onChange={(event) => setDraft({ ...draft, externalId: event.target.value })} /></SaveErrorField>
      </Field>
      <div className={styles.pair}>
        <Field label="お客様名" htmlFor="rs-trial-name" error={fields.error('name')}>
          <SaveErrorField names={["customerName","draft.customerName","customer_name","draft.customer_name"]}><TextField id="rs-trial-name" invalid={fields.invalid('name')} required value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} /></SaveErrorField>
        </Field>
        <Field label="人数" htmlFor="rs-trial-guests" error={fields.error('count')}>
          <SaveErrorField names={["guestCount","draft.guestCount","guest_count","draft.guest_count"]}><TextField id="rs-trial-guests" invalid={fields.invalid('count')} type="number" min={1} max={100} required value={draft.guestCount} onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })} /></SaveErrorField>
        </Field>
      </div>
      <Field label="開始日時" htmlFor="rs-trial-start" error={fields.error('start')}>
        <SaveErrorField names={["startsAt","draft.startsAt","starts_at","draft.starts_at"]}><DateTimeField id="rs-trial-start" invalid={fields.invalid('start')} required value={draft.startsAt} onChange={(next) => setDraft({ ...draft, startsAt: next })} /></SaveErrorField>
      </Field>
      <DialogNote>試した予約は台帳に入ります。予約媒体へは何も送りません。</DialogNote>
    </RsDialog>
  )
}
