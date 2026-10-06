'use client'

/*
 * U-1 変更の確認（v6-29 §10）。
 * 処理の核は `change-review-model.ts` の useChangeReview に置く。
 * v7 の見せ方（このファイル）と V8（`change-review-v8.tsx`）で共有する。
 */

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import TargetMissing from '@/components/shared/target-missing'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import type { EventChangeImpact } from '@/lib/api'
import EventChangeReviewV8 from '@/v8/events/change-review'
import {
  formatJp,
  noticeMessage,
  previewErrorMessage,
  useChangeReview,
} from './change-review-model'

function ChangeReviewInner({ eventId }: { eventId: string }) {
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
  } = useChangeReview(eventId)

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
          <Button variant="secondary" onClick={() => void runPreview()} disabled={previewBusy} busy={previewBusy} busyLabel="確かめています…">影響を確かめる
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
                <Button variant="primary" onClick={() => void runApply()} disabled={applyBusy} busy={applyBusy} busyLabel="変えています…">この内容で変える
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

/*
 * ★V8（板 `hmr2P`）：見た目テーマが v8 のときだけ新しい画面
 * （src/v8/events/change-review.tsx）に切り替える。処理は useChangeReview の写しで同じ。
 */
function ChangeReviewSwitch() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <EventChangeReviewV8 /> : <ChangeReviewPageInner />
}

export default function EventChangeReviewPage() {
  usePageTitle('変更の確認')
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ChangeReviewSwitch />
    </Suspense>
  )
}
