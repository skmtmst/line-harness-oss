'use client'

/*
 * U-1 変更の確認（v6-29 §10）の処理の核。
 * v7 の画面（`page.tsx` の ChangeReviewInner）と V8 の画面
 * （`change-review-v8.tsx`）で共有する。違いは置き場と見せ方だけ。
 *
 * 公開後の名前・会場・日時・定員・条件の変更は、影響する申込・待ち・
 * リマインダを先に見せてから変える。日時・会場が動いた回の確定申込へは
 * LINE で新旧を知らせる。定員を確定人数より下げられない。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import {
  eventsApi,
  type EventChangePreview,
  type EventDetail,
  type EventSlot,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'

const JST_OFFSET_MS = 9 * 3600_000

/** UTC ISO → datetime-local（日本時間の壁時計）。 */
export function isoToLocalInput(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const jst = new Date(time + JST_OFFSET_MS).toISOString()
  return jst.slice(0, 16)
}

/** datetime-local（日本時間のつもり）→ UTC ISO。 */
export function localInputToIso(local: string): string | null {
  const time = Date.parse(`${local}:00+09:00`)
  if (!Number.isFinite(time)) return null
  return new Date(time).toISOString()
}

export function formatJp(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '—'
  return formatDateTime(iso)
}

export function previewErrorMessage(code: string): string {
  switch (code) {
    case 'slot_capacity_below_bookings':
      return '定員を、すでに申し込まれている人数より下げられません'
    case 'slot_not_found':
      return '開催回が見つかりません（削除された可能性があります）'
    case 'invalid_range':
    case 'invalid_datetime':
    case 'invalid_slot_id':
    case 'invalid_capacity':
    case 'invalid_is_active':
      return '日時・定員の入力が正しくありません'
    default:
      return '確かめられませんでした'
  }
}

export function applyErrorMessage(code: string | null): string {
  switch (code) {
    case 'change_reason_required':
      return '公開中のイベントを変えるには、理由が必要です。下の「変える理由」に書いてください。'
    case 'version_conflict':
      return 'ほかの人が先に変えました。開き直して最新の内容で、もう一度お試しください。'
    case 'slot_capacity_below_bookings':
      return '定員を、すでに申し込まれている人数より下げられません。人数を確かめてから、もう一度お試しください。'
    case 'slot_not_found':
      return '開催回が見つかりません。削除された可能性があります。'
    case 'no_changes':
      return '変える内容がありません。日時・定員・会場のどれかを変えてください。'
    default:
      return '変えられませんでした。時間をおいて、もう一度お試しください。'
  }
}

export function noticeMessage(code: string): string {
  switch (code) {
    case 'capacity_reduced':
      return '定員を減らします。確定済みの申込はそのまま残ります'
    case 'datetime_moved_with_bookings':
      return '日時が動きます。確定した申込へLINEでお知らせします'
    case 'slot_deactivated_with_applicants':
      return '受付を止めても、すでにある申込・待ちは残ります'
    case 'venue_changed_with_applicants':
      return '会場が変わります。確定した申込へLINEでお知らせします'
    default:
      return code
  }
}

export interface SlotEdit {
  startsAt: string
  endsAt: string
  capacity: string
  isActive: boolean
}

export type ChangeReviewStatus = 'loading' | 'ready' | 'error' | 'not-found'

export function useChangeReview(eventId: string) {
  const { selectedAccountId } = useAccount()
  const [status, setStatus] = useState<ChangeReviewStatus>('loading')
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [slots, setSlots] = useState<EventSlot[] | null>(null)
  const [edits, setEdits] = useState<Record<string, SlotEdit>>({})
  const [venueName, setVenueName] = useState('')
  const [venueUrl, setVenueUrl] = useState('')
  const [preview, setPreview] = useState<EventChangePreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [reason, setReason] = useState('')
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applied, setApplied] = useState<{ notified: number; confirmed: number; waiting: number } | null>(null)
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID())

  const refresh = useCallback(async () => {
    if (!selectedAccountId) return
    setStatus('loading')
    setPreview(null)
    setApplied(null)
    setApplyError(null)
    try {
      const [detail, slotList] = await Promise.all([
        eventsApi.getEvent(selectedAccountId, eventId),
        eventsApi.listSlots(selectedAccountId, eventId),
      ])
      setEvent(detail)
      setSlots(slotList.items)
      const next: Record<string, SlotEdit> = {}
      for (const slot of slotList.items) {
        next[slot.id] = {
          startsAt: isoToLocalInput(slot.starts_at),
          endsAt: isoToLocalInput(slot.ends_at),
          capacity: slot.capacity == null ? '' : String(slot.capacity),
          isActive: slot.is_active === 1,
        }
      }
      setEdits(next)
      setVenueName(detail.venue_name ?? '')
      setVenueUrl(detail.venue_url ?? '')
      idempotencyKeyRef.current = crypto.randomUUID()
      setStatus('ready')
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        setStatus('not-found')
      } else {
        setStatus('error')
      }
    }
  }, [selectedAccountId, eventId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const slotList = slots ?? []
  const isPublished = event?.is_published === 1

  const touchEdits = useCallback(() => {
    setPreview(null)
    setApplied(null)
    setApplyError(null)
    idempotencyKeyRef.current = crypto.randomUUID()
  }, [])

  const buildChanges = useCallback((): {
    slotChanges: Array<{ slot_id: string; starts_at?: string; ends_at?: string; capacity?: number | null; is_active?: number }>;
    eventChanges?: { venue_name?: string | null; venue_url?: string | null };
    inputError: string | null;
  } => {
    const slotChanges: Array<{ slot_id: string; starts_at?: string; ends_at?: string; capacity?: number | null; is_active?: number }> = []
    for (const slot of slotList) {
      const edit = edits[slot.id]
      if (!edit) continue
      const change: { slot_id: string; starts_at?: string; ends_at?: string; capacity?: number | null; is_active?: number } = { slot_id: slot.id }
      if (edit.startsAt !== isoToLocalInput(slot.starts_at)) {
        const iso = localInputToIso(edit.startsAt)
        if (!iso) return { slotChanges: [], inputError: '日時の入力が正しくありません。' }
        change.starts_at = iso
      }
      if (edit.endsAt !== isoToLocalInput(slot.ends_at)) {
        const iso = localInputToIso(edit.endsAt)
        if (!iso) return { slotChanges: [], inputError: '日時の入力が正しくありません。' }
        change.ends_at = iso
      }
      const capacityText = edit.capacity.trim()
      const currentCapacity = slot.capacity == null ? '' : String(slot.capacity)
      if (capacityText !== currentCapacity) {
        if (capacityText === '') {
          change.capacity = null
        } else {
          const parsed = Number(capacityText)
          if (!Number.isInteger(parsed) || parsed < 1) return { slotChanges: [], inputError: '定員は1以上の数で入れてください。' }
          change.capacity = parsed
        }
      }
      if ((edit.isActive ? 1 : 0) !== slot.is_active) change.is_active = edit.isActive ? 1 : 0
      if (Object.keys(change).length > 1) slotChanges.push(change)
    }
    let eventChanges: { venue_name?: string | null; venue_url?: string | null } | undefined
    if (venueName !== (event?.venue_name ?? '')) {
      eventChanges = { ...(eventChanges ?? {}), venue_name: venueName === '' ? null : venueName }
    }
    if (venueUrl !== (event?.venue_url ?? '')) {
      eventChanges = { ...(eventChanges ?? {}), venue_url: venueUrl === '' ? null : venueUrl }
    }
    return { slotChanges, eventChanges, inputError: null }
  }, [slotList, edits, venueName, venueUrl, event])

  const runPreview = useCallback(async () => {
    if (!selectedAccountId || previewBusy) return
    setPreviewError('')
    setPreview(null)
    const { slotChanges, eventChanges, inputError } = buildChanges()
    if (inputError) {
      setPreviewError(inputError)
      return
    }
    if (slotChanges.length === 0 && !eventChanges) {
      setPreviewError('変える内容がありません。日時・定員・会場のどれかを変えてください。')
      return
    }
    setPreviewBusy(true)
    try {
      const result = await eventsApi.previewEventChange(selectedAccountId, eventId, {
        slot_changes: slotChanges,
        event_changes: eventChanges,
      })
      setPreview(result)
    } catch {
      setPreviewError('確かめられませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      setPreviewBusy(false)
    }
  }, [selectedAccountId, previewBusy, buildChanges, eventId])

  const runApply = useCallback(async () => {
    if (!selectedAccountId || applyBusy || !preview || preview.blocked) return
    setApplyError(null)
    const { slotChanges, eventChanges } = buildChanges()
    setApplyBusy(true)
    try {
      const result = await eventsApi.applyEventChange(selectedAccountId, eventId, {
        expected_version: event?.version ?? 1,
        change_reason: reason.trim() === '' ? undefined : reason.trim(),
        idempotency_key: idempotencyKeyRef.current,
        slot_changes: slotChanges,
        event_changes: eventChanges,
      })
      setApplied({
        notified: result.notified ?? 0,
        confirmed: result.affected_confirmed ?? 0,
        waiting: result.affected_waiting ?? 0,
      })
      setPreview(null)
      const detail = await eventsApi.getEvent(selectedAccountId, eventId)
      setEvent(detail)
    } catch (error) {
      const code = (error as { body?: { error?: string } }).body?.error ?? null
      setApplyError(applyErrorMessage(code))
    } finally {
      setApplyBusy(false)
    }
  }, [selectedAccountId, applyBusy, preview, buildChanges, eventId, event, reason])

  return {
    selectedAccountId,
    status,
    event,
    slots,
    slotList,
    edits,
    setEdits,
    venueName,
    setVenueName,
    venueUrl,
    setVenueUrl,
    preview,
    previewBusy,
    previewError,
    reason,
    setReason,
    applyBusy,
    applyError,
    applied,
    isPublished,
    refresh,
    touchEdits,
    runPreview,
    runApply,
  }
}
