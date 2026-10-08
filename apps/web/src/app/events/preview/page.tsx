'use client'

/*
 * U お客様表示確認（v6-29 §5）。
 * 公開条件で申込画面を確認する。運営向けの注記は帯に1本だけ置き、
 * 本文にはお客様に見える内容だけを出す。
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useResponseGate } from '@/lib/use-response-gate'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import TargetMissing from '@/components/shared/target-missing'
import {
  eventsApi,
  type EventDetail,
  type EventSlot,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'

function formatJpRange(startsAt: string, endsAt: string): string {
  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '日時未取得'
  const format = (time: number) =>
    formatDateTime(time)
  return `${format(start)}〜${formatDateTime(end)}`
}

function PreviewInner({ eventId }: { eventId: string }) {
  const { selectedAccountId } = useAccount()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [slots, setSlots] = useState<EventSlot[]>([])

  /* WEB320：アカウント・イベントを変えたら、前の遅い応答を捨てる。 */
  const gate = useResponseGate()
  const refresh = useCallback(async () => {
    const token = gate.begin()
    if (!selectedAccountId) return
    setStatus('loading')
    try {
      const [detail, slotList] = await Promise.all([
        eventsApi.getEvent(selectedAccountId, eventId),
        eventsApi.listSlots(selectedAccountId, eventId),
      ])
      if (!gate.current(token)) return
      setEvent(detail)
      setSlots(slotList.items.filter((slot) => slot.is_active === 1))
      setStatus('ready')
    } catch (error) {
      if (!gate.current(token)) return
      if ((error as { status?: number }).status === 404) {
        setStatus('not-found')
      } else {
        setStatus('error')
      }
    }
  }, [selectedAccountId, eventId, gate])

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
          <span>お客様表示の確認</span>
        </nav>
      </div>

      <Notice
        tone="info"
        message="お客様に見える内容です。オンラインのURLは、確定した申込にだけ見せます（ここでは運営なので全部見えています）。"
      />

      <section className="bg-canvas rounded-card border-hairline border p-6" aria-label="お客様表示">
        {event.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.image_url} alt="" className="rounded-control mb-4 max-h-64 w-full object-cover" />
        )}
        <h2 className="text-ink text-lg font-bold">{event.name}</h2>
        {event.description && (
          <p className="text-ink-secondary mt-2 text-sm leading-6 whitespace-pre-wrap">{event.description}</p>
        )}
        {event.venue_name && (
          <p className="text-ink-secondary mt-3 text-sm">
            会場：{event.venue_name}
          </p>
        )}
        {event.venue_url && (
          <p className="text-ink-faint mt-1 text-xs">
            オンラインのURLは確定後に案内します
            <HelpTip label="オンラインのURLの説明">
              確定前の申込や、申し込んでいない人にはURLを渡しません。確定した人の予約履歴にだけ出ます。
            </HelpTip>
          </p>
        )}
        <h3 className="text-ink mt-4 text-sm font-bold">時間を選ぶ</h3>
        {slots.length === 0 ? (
          <p className="text-ink-faint mt-1 text-sm">選べる時間がありません。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {slots.map((slot) => (
              <li
                key={slot.id}
                className="border-hairline rounded-control flex items-center justify-between gap-2 border px-3 py-2"
              >
                <span className="text-ink text-sm tabular-nums">{formatJpRange(slot.starts_at, slot.ends_at)}</span>
                <span className="text-ink-faint text-xs whitespace-nowrap">
                  {slot.capacity == null ? '定員なし' : `定員 ${slot.capacity}人`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function PreviewPageInner() {
  const params = useSearchParams()
  const id = params.get('id')
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="確認するイベントが指定されていません"
        description="一覧から、表示を確認するイベントを選び直してください。"
        backHref="/events"
        backLabel="イベント一覧へ戻る"
      />
    )
  }
  return <PreviewInner eventId={id} />
}

export default function EventPreviewPage() {
  usePageTitle('お客様表示の確認')
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <PreviewPageInner />
    </Suspense>
  )
}
