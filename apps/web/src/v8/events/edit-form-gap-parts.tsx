'use client'

import { japaneseDetailOf } from '@/components/shared/api-error-message'

import { jstDate } from '@/lib/jst-datetime';
import { useRef, useState } from 'react';
import { type EventSlot } from '@/lib/api';
import { jstHHMMToUtcIso, utcIsoToJstDate, utcIsoToJstHHMM } from '@/components/events/jst';
import Dialog from '@/components/shared/dialog';
import Notice from '@/components/shared/notice';
import { Field, TextInput } from '@/components/shared/form-controls';
import DateField from '@/components/shared/date-field';
import { TimeField } from '@/components/shared/date-time-field';
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors';


function AddSlotDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (s: { starts_at: string; ends_at: string; capacity: number | null }) => Promise<void>
}) {
  const saveErrors = useSaveFormErrors()
  const todayJst = jstDate()
  const [date, setDate] = useState(todayJst)
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('12:00')
  const [capacity, setCapacity] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 保存中はEscapeで窓だけ消えないようにする（共通の窓の約束）。

  const submitLock = useRef(false)

  async function submit() {
    if (submitLock.current) return
    submitLock.current = true
    setBusy(true)
    setErr(null)
    try {
      const s = jstHHMMToUtcIso(date, startTime)
      const e = jstHHMMToUtcIso(date, endTime)
      if (s >= e) { setErr('開始時刻 < 終了時刻'); return }
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) { setErr('定員は1以上の整数'); return }
      await onSubmit({ starts_at: s, ends_at: e, capacity: cap })
    } catch (e) {
      saveErrors.capture(e)
      setErr(japaneseDetailOf(e) || '保存できませんでした。もう一度お試しください。')
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  return <SaveErrorScope errors={saveErrors}><Dialog open title="予約枠を追加" onCancel={onClose} onConfirm={submit} confirmLabel="追加する" busy={busy} error={err ?? undefined}>

    <Field label="日付（JST）"><SaveErrorField names={["date"]}><DateField value={date} onChange={setDate} aria-label="日付（JST）" /></SaveErrorField></Field>
    <Field label="開始"><SaveErrorField names={["startTime","start_time","starts_at","startsAt"]}><TimeField value={startTime} onChange={setStartTime} aria-label="開始" /></SaveErrorField></Field>
    <Field label="終了"><SaveErrorField names={["endTime","end_time","ends_at","endsAt"]}><TimeField value={endTime} onChange={setEndTime} aria-label="終了" /></SaveErrorField></Field>
    <Field label="定員（空欄=無制限）"><SaveErrorField names={["capacity"]}><TextInput type="number" min={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} /></SaveErrorField></Field>
  </Dialog></SaveErrorScope>
}



/*
 * 入口29: 既存の予約枠の日時・定員を直す窓。
 *
 * 追加と同じ入力（日付・開始・終了・定員）を、保存値で埋めた状態で開く。
 * 口側の決めごとと同じ検査をここでも先に行う:
 * - 開始 < 終了
 * - 定員は1以上の整数（空欄=無制限）
 * - 予約が入っている枠は、定員をいまの予約数より下げられない
 *
 * 日時を動かしたとき、確定している予約のリマインド予定は口側が
 * 新しい日時へ合わせて動かす。予約者へ「変わった」ことが伝わるよう、
 * 予約のある枠ではそのことを窓の中へ書く。
 */
function EditSlotDialog({
  slot,
  onClose,
  onSubmit,
}: {
  slot: EventSlot
  onClose: () => void
  onSubmit: (s: { starts_at: string; ends_at: string; capacity: number | null }) => Promise<void>
}) {
  const saveErrors = useSaveFormErrors()
  const booked = slot.active_count ?? 0
  const [date, setDate] = useState(() => utcIsoToJstDate(slot.starts_at))
  const [startTime, setStartTime] = useState(() => utcIsoToJstHHMM(slot.starts_at))
  const [endTime, setEndTime] = useState(() => utcIsoToJstHHMM(slot.ends_at))
  const [capacity, setCapacity] = useState<string>(slot.capacity == null ? '' : String(slot.capacity))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submitLock = useRef(false)

  async function submit() {
    if (submitLock.current) return
    submitLock.current = true
    setBusy(true)
    setErr(null)
    try {
      const s = jstHHMMToUtcIso(date, startTime)
      const e = jstHHMMToUtcIso(date, endTime)
      if (s >= e) { setErr('開始時刻 < 終了時刻'); return }
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) { setErr('定員は1以上の整数'); return }
      if (cap != null && cap < booked) {
        setErr(`この枠には${booked}件の予約が入っています。定員は${booked}以上にしてください`)
        return
      }
      await onSubmit({ starts_at: s, ends_at: e, capacity: cap })
    } catch (e) {
      saveErrors.capture(e)
      setErr(japaneseDetailOf(e) || '保存できませんでした。もう一度お試しください。')
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  // 保存中はEscapeで窓だけ消えないようにする（共通の窓の約束）。

  // 新しい部品はデザイントークンで書く（このファイルの古い生色クラスを増やさない）。
  return <SaveErrorScope errors={saveErrors}><Dialog open title="予約枠を編集" onCancel={onClose} onConfirm={submit} confirmLabel="保存する" busy={busy} error={err ?? undefined}>
    {booked > 0 ? <Notice tone="warn" message={`この枠には${booked}件の予約が入っています。日時を変えると、確定している予約のリマインド予定も新しい日時へ合わせて動きます。定員は${booked}以上にしてください。`} /> : null}
    <Field label="日付（JST）"><SaveErrorField names={["date"]}><DateField value={date} onChange={setDate} aria-label="日付（JST）" /></SaveErrorField></Field>
    <Field label="開始"><SaveErrorField names={["startTime","start_time","starts_at","startsAt"]}><TimeField value={startTime} onChange={setStartTime} aria-label="開始" /></SaveErrorField></Field>
    <Field label="終了"><SaveErrorField names={["endTime","end_time","ends_at","endsAt"]}><TimeField value={endTime} onChange={setEndTime} aria-label="終了" /></SaveErrorField></Field>
    <Field label="定員（空欄=無制限）"><SaveErrorField names={["capacity"]}><TextInput type="number" min={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} /></SaveErrorField></Field>
  </Dialog></SaveErrorScope>
}
export { AddSlotDialog, EditSlotDialog }
