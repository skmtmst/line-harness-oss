'use client'

/*
 * ★V8-B イベント予約の「変更の確認」（板 `hmr2P`）。
 *
 * 処理は `change-review-model.ts` の useChangeReview で v7 と同じ。
 * 違いは置き場と見せ方だけ——左に開催回と変える内容、右に影響の確認と
 * 約束、下に追従する変える・やめるの帯。
 */

import { useState } from 'react'
import Link from 'next/link'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import TargetMissing from '@/components/shared/target-missing'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  formatJp,
  isoToLocalInput,
  noticeMessage,
  previewErrorMessage,
  useChangeReview,
} from './change-review-model'
import styles from './change-review-v8.module.css'

/** datetime-local の入力値（壁時計）を見やすく出す。 */
function formatLocalInput(local: string): string {
  if (!local) return '—'
  const [date, time] = local.split('T')
  if (!date || !time) return local
  return `${date} ${time}`
}

export default function ChangeReviewV8({ eventId }: { eventId: string }) {
  usePageTitle('変更の確認')
  const model = useChangeReview(eventId)
  const {
    selectedAccountId,
    status,
    event,
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
  } = model
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)

  if (!selectedAccountId) {
    return (
      <div className={styles.board} data-design-node="hmr2P">
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          アカウントを選択してください。
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className={styles.board} data-design-node="hmr2P">
        <ListState kind="loading" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className={styles.board} data-design-node="hmr2P">
        <ListState
          kind="error"
          description="イベントは消えていません。開き直しても直らない場合はエラー報告へ。"
          action={<Button onClick={() => void refresh()}>開き直す</Button>}
        />
      </div>
    )
  }

  if (status === 'not-found' || !event) {
    return (
      <div className={styles.board} data-design-node="hmr2P">
        <TargetMissing
          kind="not-found"
          title="イベントが見つかりません"
          description="削除されたか、別のアカウントのイベントです。一覧から選び直してください。"
          backHref="/events"
          backLabel="イベント一覧へ戻る"
        />
      </div>
    )
  }

  const activeSlotId = selectedSlotId ?? slotList[0]?.id ?? null
  const activeSlot = slotList.find((slot) => slot.id === activeSlotId) ?? null
  const activeEdit = activeSlot ? (edits[activeSlot.id] ?? { startsAt: '', endsAt: '', capacity: '', isActive: true }) : null
  const impactBySlot = new Map((preview?.impacts ?? []).map((impact) => [impact.slot_id, impact]))

  const updateActiveEdit = (patch: Partial<{ startsAt: string; endsAt: string; capacity: string; isActive: boolean }>) => {
    if (!activeSlot || !activeEdit) return
    setEdits((current) => ({ ...current, [activeSlot.id]: { ...activeEdit, ...patch } }))
    touchEdits()
  }

  // 変えた開催回だけを「変える前→変えた後」で出す。
  const changedLines: string[] = []
  for (const slot of slotList) {
    const edit = edits[slot.id]
    if (!edit) continue
    const bits: string[] = []
    if (edit.startsAt !== isoToLocalInput(slot.starts_at) || edit.endsAt !== isoToLocalInput(slot.ends_at)) {
      bits.push(`${formatLocalInput(isoToLocalInput(slot.starts_at))}〜${formatLocalInput(isoToLocalInput(slot.ends_at)).split(' ')[1] ?? ''} → ${formatLocalInput(edit.startsAt)}〜${formatLocalInput(edit.endsAt).split(' ')[1] ?? ''}`)
    }
    if (edit.capacity.trim() !== (slot.capacity == null ? '' : String(slot.capacity))) {
      bits.push(`定員 ${slot.capacity == null ? 'なし' : `${slot.capacity}人`} → ${edit.capacity.trim() === '' ? 'なし' : `${edit.capacity.trim()}人`}`)
    }
    if ((edit.isActive ? 1 : 0) !== slot.is_active) {
      bits.push(`受付 ${slot.is_active === 1 ? 'する' : '止める'} → ${edit.isActive ? 'する' : '止める'}`)
    }
    if (bits.length > 0) changedLines.push(`${formatJp(slot.starts_at)}の回：${bits.join('・')}`)
  }
  const firstChangedSlot = slotList.find((slot) => {
    const edit = edits[slot.id]
    return edit && (edit.startsAt !== isoToLocalInput(slot.starts_at) || edit.endsAt !== isoToLocalInput(slot.ends_at))
  })
  const firstChangedEdit = firstChangedSlot ? edits[firstChangedSlot.id] : undefined

  return (
    <div className={styles.board} data-design-node="hmr2P">
      <div>
        <Link href="/events" className={styles.backLink}>
          ← イベント予約へ
        </Link>
        <h2 className={styles.headTitle}>変更の確認：{event.name}</h2>
        <p className={styles.headDescription}>
          開催回の日時・定員・受付を変えます。変える前に、申し込んでいる人への影響を確かめます。
        </p>
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

      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.card} aria-label="開催回">
            <h3 className={styles.cardTitle}>開催回</h3>
            <p className={styles.cardNote}>変える回を選ぶます</p>
            {slotList.length === 0 ? (
              <p className="text-ink-faint mt-2 text-sm">開催回がありません。編集で開催回を足してから、もう一度開いてください。</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <DataTable data-design="Table">
                  <thead>
                    <TableHeadRow>
                      <Th style={{ width: '6%' }}><span className="sr-only">選ぶ</span></Th>
                      <Th style={{ width: '30%' }}>開始</Th>
                      <Th style={{ width: '12%' }} align="right">定員</Th>
                      <Th style={{ width: '12%' }} align="right">確定</Th>
                      <Th style={{ width: '12%' }} align="right">待ち</Th>
                      <Th align="right" className="w-28">受付</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {slotList.map((slot) => {
                      const edit = edits[slot.id]
                      const impact = impactBySlot.get(slot.id)
                      const receiving = edit ? edit.isActive : slot.is_active === 1
                      return (
                        <Tr key={slot.id} interactive={activeSlotId === slot.id}>
                          <Td>
                            <input
                              type="radio"
                              name="change-review-slot"
                              checked={activeSlotId === slot.id}
                              onChange={() => setSelectedSlotId(slot.id)}
                              aria-label={`${formatJp(slot.starts_at)}の回を選ぶ`}
                            />
                          </Td>
                          <Td className="whitespace-nowrap text-sm tabular-nums">{formatJp(slot.starts_at)}</Td>
                          <Td align="right" className="tabular-nums">{slot.capacity ?? '—'}</Td>
                          <Td align="right" className="tabular-nums">{impact ? impact.confirmed_seats : '—'}</Td>
                          <Td align="right" className="tabular-nums">{impact ? impact.waiting_seats : '—'}</Td>
                          <Td align="right">
                            <span className={receiving ? 'bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs' : 'bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-xs'}>
                              {receiving ? '● 受付する' : '● 終了'}
                            </span>
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </DataTable>
              </div>
            )}
          </section>

          <section className={styles.card} aria-label="変える内容">
            <h3 className={styles.cardTitle}>変える内容</h3>
            {activeSlot ? (
              <>
                <p className={styles.cardNote}>{formatJp(activeSlot.starts_at)} の回</p>
                <div className={`${styles.fieldGrid} mt-3`}>
                  <label className="grid gap-1 text-xs font-medium text-ink-secondary">
                    開始日時
                    <input
                      type="datetime-local"
                      value={activeEdit?.startsAt ?? ''}
                      onChange={(e) => updateActiveEdit({ startsAt: e.target.value })}
                      aria-label="開始日時"
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-ink-secondary">
                    終了日時
                    <input
                      type="datetime-local"
                      value={activeEdit?.endsAt ?? ''}
                      onChange={(e) => updateActiveEdit({ endsAt: e.target.value })}
                      aria-label="終了日時"
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-ink-secondary">
                    定員
                    <input
                      type="number"
                      min={1}
                      value={activeEdit?.capacity ?? ''}
                      placeholder={activeSlot.capacity == null ? 'なし' : String(activeSlot.capacity)}
                      onChange={(e) => updateActiveEdit({ capacity: e.target.value })}
                      aria-label="定員"
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <div className="grid gap-1 text-xs font-medium text-ink-secondary">
                    受付の有無
                    <Select
                      value={(activeEdit?.isActive ?? true) ? '1' : '0'}
                      onChange={(value) => updateActiveEdit({ isActive: value === '1' })}
                      aria-label="受付の有無"
                      options={[
                        { value: '1', label: '受付する' },
                        { value: '0', label: '止める' },
                      ]}
                    />
                  </div>
                </div>
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
                </div>
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => void runPreview()} disabled={previewBusy} busy={previewBusy} busyLabel="確かめています…">
                    影響を確かめる
                  </Button>
                  {previewError && (
                    <p className="text-danger mt-2 text-sm" role="alert">
                      {previewError}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-ink-faint mt-2 text-sm">開催回がありません。編集で開催回を足してから、もう一度開いてください。</p>
            )}
          </section>
        </div>

        <div className={styles.rail}>
          <section className={styles.card} aria-label="影響の確認" aria-live="polite">
            <h3 className={styles.cardTitle}>影響の確認</h3>
            {!preview ? (
              <p className={styles.cardNote}>左で内容を変えて「影響を確かめる」を押すと、ここに誰への影響が出ます。</p>
            ) : (
              <>
                <div className={styles.impactBand}>
                  <span className={styles.impactBandTitle}>
                    {preview.blocked ? 'このままでは変えられません' : '日時が変わります'}
                  </span>
                  <br />
                  確定した申込 {preview.total_confirmed}人へ、LINEで新旧の日時をお知らせします。
                  キャンセル待ち {preview.total_waiting}人は順番のままです。
                </div>
                {changedLines.length > 0 && (
                  <>
                    <p className={styles.beforeAfter}>変える前 → 変えた後</p>
                    <ul className={styles.promiseList}>
                      {changedLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}
                {firstChangedSlot && firstChangedEdit && (
                  <div className={styles.sampleBubble}>
                    【日時変更のお知らせ】{event.name}は、{formatLocalInput(firstChangedEdit.startsAt)}に変わりました（変更前 {formatLocalInput(isoToLocalInput(firstChangedSlot.starts_at))}）。（送る文面の見本）
                  </div>
                )}
                {preview.impacts.flatMap((impact) => [...impact.errors, ...impact.notices]).length > 0 && (
                  <ul className={styles.promiseList}>
                    {preview.impacts.flatMap((impact) =>
                      [...impact.errors.map((code) => previewErrorMessage(code)), ...impact.notices.map((code) => noticeMessage(code))].map(
                        (text) => <li key={`${impact.slot_id}-${text}`}>{text}</li>,
                      ),
                    )}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className={styles.card} aria-label="日時・会場を変えるときの約束">
            <h3 className={styles.cardTitle}>日時・会場を変えるときの約束</h3>
            <ul className={styles.promiseList}>
              <li>変えた内容は記録に残ります（消すことはできません）</li>
              <li>定員を、すでに申し込まれている人数より下げることはできません</li>
              <li>日時・会場が動いた回の確定した申込へは、LINEで新旧をお知らせします</li>
            </ul>
          </section>
        </div>
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" href={`/events/edit?id=${eventId}`}>
          キャンセル
        </Button>
        <Button
          variant="primary"
          onClick={() => void runApply()}
          disabled={!preview || preview.blocked || applyBusy}
          busy={applyBusy}
          busyLabel="変えています…"
          title={!preview ? '先に「影響を確かめる」を押してください' : undefined}
        >
          ✓ 変えてお知らせする
        </Button>
      </div>
      {applyError && (
        <p className="text-danger text-center text-sm" role="alert">
          {applyError}
        </p>
      )}
    </div>
  )
}
