'use client'

/*
 * U-1 変更の確認（v6-29 §10）。
 * 公開後の名前・会場・日時・定員・条件の変更は、影響する申込・待ち・
 * リマインダを先に見せてから変える。日時・会場が動いた回の確定申込へは
 * LINE で新旧を知らせる。定員を確定人数より下げられない。
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import TargetMissing from '@/components/shared/target-missing'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  eventsApi,
  type EventChangeImpact,
  type EventChangePreview,
  type EventDetail,
  type EventSlot,
} from '@/lib/api'

const JST_OFFSET_MS = 9 * 3600_000

/** UTC ISO → datetime-local（日本時間の壁時計）。 */
function isoToLocalInput(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const jst = new Date(time + JST_OFFSET_MS).toISOString()
  return jst.slice(0, 16)
}

/** datetime-local（日本時間のつもり）→ UTC ISO。 */
function localInputToIso(local: string): string | null {
  const time = Date.parse(`${local}:00+09:00`)
  if (!Number.isFinite(time)) return null
  return new Date(time).toISOString()
}

function formatJp(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tokyo',
  })
}

function previewErrorMessage(code: string): string {
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

function applyErrorMessage(code: string | null): string {
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

function noticeMessage(code: string): string {
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

interface SlotEdit {
  startsAt: string
  endsAt: string
  capacity: string
  isActive: boolean
}

function ChangeReviewInner({ eventId }: { eventId: string }) {
  const { selectedAccountId } = useAccount()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
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

  if (!selectedAccountId) {
    return (
      <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
        アカウントを選択してください。
      </p>
    )
  }

  if (status === 'loading') return <ListState kind="loading" />
  if (status === 'error') {
    return (
      <ListState
        kind="error"
        description="イベントは消えていません。開き直しても直らない場合はエラー報告へ。"
        action={<Button onClick={() => void refresh()}>開き直す</Button>}
      />
    )
  }
  if (status === 'not-found' || !event) {
    return (
      <TargetMissing
        kind="not-found"
        title="イベントが見つかりません"
        description="削除されたか、別のアカウントのイベントです。一覧から選び直してください。"
        backHref="/events"
        backLabel="イベント一覧へ戻る"
      />
    )
  }

  const slotList = slots ?? []
  const isPublished = event.is_published === 1

  const touchEdits = () => {
    setPreview(null)
    setApplied(null)
    setApplyError(null)
    idempotencyKeyRef.current = crypto.randomUUID()
  }

  const buildChanges = (): {
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
    if (venueName !== (event.venue_name ?? '')) {
      eventChanges = { ...(eventChanges ?? {}), venue_name: venueName === '' ? null : venueName }
    }
    if (venueUrl !== (event.venue_url ?? '')) {
      eventChanges = { ...(eventChanges ?? {}), venue_url: venueUrl === '' ? null : venueUrl }
    }
    return { slotChanges, eventChanges, inputError: null }
  }

  const runPreview = async () => {
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
  }

  const runApply = async () => {
    if (!selectedAccountId || applyBusy || !preview || preview.blocked) return
    setApplyError(null)
    const { slotChanges, eventChanges } = buildChanges()
    setApplyBusy(true)
    try {
      const result = await eventsApi.applyEventChange(selectedAccountId, eventId, {
        expected_version: event.version ?? 1,
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
  }

  const impactBySlot = new Map((preview?.impacts ?? []).map((impact) => [impact.slot_id, impact]))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <nav className="text-ink-faint text-xs" aria-label="パンくず">
          <Link href="/events" className="hover:underline">
            イベント予約
          </Link>
          <span className="mx-1.5">/</span>
          <Link href={`/events/edit?id=${eventId}`} className="hover:underline">
            編集
          </Link>
          <span className="mx-1.5">/</span>
          <span>変更の確認</span>
        </nav>
        <p className="text-ink mt-1 text-base font-bold">{event.name}</p>
      </div>

      <Notice
        tone="info"
        message="変える前に、誰に影響するかを確かめてから変えます。日時・会場が動いた回の確定した申込へは、LINEで新旧をお知らせします。"
      />

      {applied && (
        <div className="bg-canvas rounded-card border-hairline border p-4" role="status">
          <p className="text-ink text-sm font-bold">変えました</p>
          <p className="text-ink-secondary mt-1 text-sm">
            影響した申込は確定 {applied.confirmed}人・待ち {applied.waiting}人で、LINEのお知らせは {applied.notified}人に送りました。
          </p>
          <p className="mt-2">
            <Link href={`/events/edit?id=${eventId}`} className="text-action text-sm hover:underline">
              編集に戻る
            </Link>
          </p>
        </div>
      )}

      <section className="bg-canvas rounded-card border-hairline border p-4" aria-label="変える内容">
        <h2 className="text-ink text-sm font-bold">
          変える内容
          <HelpTip label="変える内容の説明">
            変えたところだけを送ります。定員の空欄は「定員なし」になります。
          </HelpTip>
        </h2>
        {slotList.length === 0 ? (
          <p className="text-ink-faint mt-2 text-sm">開催回がありません。編集で開催回を足してから、もう一度開いてください。</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <DataTable data-design="Table">
              <thead>
                <TableHeadRow>
                  <Th style={{ width: '30%' }}>開催回</Th>
                  <Th style={{ width: '24%' }}>開始</Th>
                  <Th style={{ width: '24%' }}>終了</Th>
                  <Th style={{ width: '12%' }} align="right">定員</Th>
                  <Th align="right" className="w-28">受付</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {slotList.map((slot) => {
                  const edit = edits[slot.id] ?? { startsAt: '', endsAt: '', capacity: '', isActive: true }
                  return (
                    <Tr key={slot.id}>
                      <Td className="whitespace-nowrap text-sm tabular-nums">{formatJp(slot.starts_at)}</Td>
                      <Td>
                        <input
                          type="datetime-local"
                          value={edit.startsAt}
                          onChange={(e) => {
                            setEdits((current) => ({ ...current, [slot.id]: { ...edit, startsAt: e.target.value } }))
                            touchEdits()
                          }}
                          aria-label="開始日時"
                          className="border-hairline rounded-control w-full border px-2 py-1 text-sm"
                        />
                      </Td>
                      <Td>
                        <input
                          type="datetime-local"
                          value={edit.endsAt}
                          onChange={(e) => {
                            setEdits((current) => ({ ...current, [slot.id]: { ...edit, endsAt: e.target.value } }))
                            touchEdits()
                          }}
                          aria-label="終了日時"
                          className="border-hairline rounded-control w-full border px-2 py-1 text-sm"
                        />
                      </Td>
                      <Td align="right">
                        <input
                          type="number"
                          min={1}
                          value={edit.capacity}
                          placeholder={slot.capacity == null ? 'なし' : String(slot.capacity)}
                          onChange={(e) => {
                            setEdits((current) => ({ ...current, [slot.id]: { ...edit, capacity: e.target.value } }))
                            touchEdits()
                          }}
                          aria-label="定員"
                          className="border-hairline rounded-control w-20 border px-2 py-1 text-right text-sm tabular-nums"
                        />
                      </Td>
                      <Td align="right">
                        <Select
                          value={edit.isActive ? '1' : '0'}
                          onChange={(value) => {
                            setEdits((current) => ({ ...current, [slot.id]: { ...edit, isActive: value === '1' } }))
                            touchEdits()
                          }}
                          aria-label="受付の有無"
                          options={[
                            { value: '1', label: '受付する' },
                            { value: '0', label: '止める' },
                          ]}
                        />
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </DataTable>
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-ink-secondary">
            会場
            <input
              value={venueName}
              onChange={(e) => {
                setVenueName(e.target.value)
                touchEdits()
              }}
              placeholder={event.venue_name ?? '未設定'}
              className="border-hairline rounded-control border px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-secondary">
            オンラインのURL（確定した申込にだけ見せます）
            <input
              value={venueUrl}
              onChange={(e) => {
                setVenueUrl(e.target.value)
                touchEdits()
              }}
              placeholder={event.venue_url ?? '未設定'}
              inputMode="url"
              className="border-hairline rounded-control border px-3 py-2 text-sm font-normal"
            />
          </label>
        </div>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void runPreview()} disabled={previewBusy}>
            {previewBusy ? '確かめています…' : '影響を確かめる'}
          </Button>
          {previewError && (
            <p className="text-danger mt-2 text-sm" role="alert">
              {previewError}
            </p>
          )}
        </div>
      </section>

      {preview && (
        <section className="bg-canvas rounded-card border-hairline border p-4" aria-label="影響の確認" aria-live="polite">
          <h2 className="text-ink text-sm font-bold">影響の確認</h2>
          <p className="text-ink-secondary mt-1 text-sm">
            確定 {preview.total_confirmed}人・待ち {preview.total_waiting}人に影響します。
            {preview.blocked
              ? '止まる理由があるので、このままでは変えられません。'
              : 'よければ理由を書いて変えます。'}
          </p>
          <div className="mt-3 overflow-x-auto">
            <DataTable data-design="Table">
              <thead>
                <TableHeadRow>
                  <Th style={{ width: '26%' }}>開催回</Th>
                  <Th style={{ width: '14%' }} align="right">確定</Th>
                  <Th style={{ width: '14%' }} align="right">待ち</Th>
                  <Th style={{ width: '46%' }}>結果</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {preview.impacts.map((impact: EventChangeImpact) => (
                  <Tr key={impact.slot_id}>
                    <Td className="whitespace-nowrap text-sm tabular-nums">{formatJp(impact.starts_at)}</Td>
                    <Td align="right" className="tabular-nums">
                      {impact.confirmed_seats}人
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {impact.waiting_seats}人
                    </Td>
                    <Td className="text-sm">
                      {impact.errors.length > 0 ? (
                        <ul className="text-danger space-y-1">
                          {impact.errors.map((code) => (
                            <li key={code}>{previewErrorMessage(code)}</li>
                          ))}
                        </ul>
                      ) : impact.notices.length > 0 ? (
                        <ul className="text-ink-secondary space-y-1">
                          {impact.notices.map((code) => (
                            <li key={code}>{noticeMessage(code)}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-ink-faint">影響はありません</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>
          {!preview.blocked && (
            <div className="mt-3">
              <label className="grid gap-1 text-xs font-medium text-ink-secondary">
                変える理由{isPublished ? '（必須）' : '（任意）'}
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="例：会場の都合で時間を30分遅らせます"
                  aria-label="変える理由"
                  className="border-hairline rounded-control border px-3 py-2 text-sm font-normal"
                />
              </label>
              <p className="text-ink-faint mt-1 text-xs">理由は変更の記録に残ります。友だちには送りません。</p>
              <div className="mt-2">
                <Button variant="primary" onClick={() => void runApply()} disabled={applyBusy}>
                  {applyBusy ? '変えています…' : 'この内容で変える'}
                </Button>
              </div>
              {applyError && (
                <p className="text-danger mt-2 text-sm" role="alert">
                  {applyError}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <Disclosure size="compact" title="日時・会場を変えるときの約束">
        <ul className="text-ink-secondary space-y-1 text-xs leading-relaxed">
          <li>・定員を、すでに申し込まれている人数より下げることはできません</li>
          <li>・日時・会場が動いた回の確定した申込へは、LINEで新旧をお知らせします</li>
          <li>・変えた内容は記録に残ります（消すことはできません）</li>
        </ul>
      </Disclosure>
    </div>
  )
}

function ChangeReviewPageInner() {
  const params = useSearchParams()
  const id = params.get('id')
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="確認するイベントが指定されていません"
        description="一覧から、変更を確認するイベントを選び直してください。"
        backHref="/events"
        backLabel="イベント一覧へ戻る"
      />
    )
  }
  return <ChangeReviewInner eventId={id} />
}

export default function EventChangeReviewPage() {
  usePageTitle('変更の確認')
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ChangeReviewPageInner />
    </Suspense>
  )
}
