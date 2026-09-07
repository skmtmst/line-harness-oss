'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarCheck2, Copy, Eye, List, Send } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import NoteBar from '@/components/shared/note-bar'
import BroadcastStepRail from '@/components/broadcasts/broadcast-step-rail'
import { useAccount } from '@/contexts/account-context'
import { api, type ApiBroadcast } from '@/lib/api'

type AudienceEstimate = {
  audienceCount: number
  hiddenExcluded: number
  warnings: Array<{ level: 'info' | 'warning'; message: string }>
}

const TARGET_LABELS: Record<ApiBroadcast['targetType'], string> = {
  all: 'このアカウントの友だち全員',
  tag: '指定したタグが付いている友だち',
  segment: '詳細条件に合う友だち',
  'multi-account-dedup': '複数アカウントから重複を除いた友だち',
}

function formatJst(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatJstSentence(value: string | null): string {
  if (!value) return '日時未設定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時未設定'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function belongsToAccount(broadcast: ApiBroadcast, selectedAccountId: string | null): boolean {
  if (!selectedAccountId) return true
  if (broadcast.targetType === 'multi-account-dedup') {
    return broadcast.accountIds?.includes(selectedAccountId) ?? false
  }
  return broadcast.lineAccountId === selectedAccountId
}

function ReservedBroadcastContent() {
  usePageTitle('一斉配信・予約完了')
  const router = useRouter()
  const id = useSearchParams().get('id')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null)
  const [notificationText, setNotificationText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /*
    予約の取消。**送信が始まったあとは戻せない**ので、押す前に何が起きるかを
    読ませ、押している間は受け付けない。取り消しても中身は消えず、下書きに
    戻るだけ——作り直しにならないことを先に言う。
  */
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelled, setCancelled] = useState(false)
  const [actionBusy, setActionBusy] = useState<'test' | 'duplicate' | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const duplicateKey = useRef<string | null>(null)
  const requestGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    const isCurrent = () => requestGeneration.current === generation

    if (!id) {
      if (!isCurrent()) return
      setBroadcast(null)
      setError('予約した配信を特定できませんでした。')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    setEstimate(null)
    try {
      const result = await api.broadcasts.get(id)
      if (!isCurrent()) return
      if (!result.success) {
        setBroadcast(null)
        setError('予約した配信を表示できませんでした。')
        return
      }

      setBroadcast(result.data)
      if (result.data.lineAccountId) {
        try {
          const notifications = await api.broadcasts.notificationSettings(result.data.lineAccountId)
          if (isCurrent() && notifications.success) setNotificationText(notifications.data.displayText)
        } catch {
          if (isCurrent()) setNotificationText('')
        }
      }
      // 完了した予約の取得と、現在人数の再集計は別の結果として扱う。
      // 人数だけ取れないときに予約そのものまで「表示できない」に戻さない。
      try {
        const preflight = await api.broadcasts.preflight({
          targetType: result.data.targetType,
          targetTagId: result.data.targetTagId,
          segmentConditions: result.data.segmentConditions ?? null,
          lineAccountId: result.data.lineAccountId,
          accountIds: result.data.accountIds ?? undefined,
          messageContent: result.data.messageContent,
        })
        if (!isCurrent()) return
        if (preflight.success) setEstimate(preflight.data)
      } catch {
        if (isCurrent()) setEstimate(null)
      }
    } catch {
      if (!isCurrent()) return
      setBroadcast(null)
      setError('予約した配信を表示できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
    return () => {
      requestGeneration.current += 1
    }
  }, [load])

  if (accountLoading || loading) {
    return <ListState kind="loading" title="予約結果を確認しています" />
  }

  if (error || !broadcast) {
    return (
      <ListState
        kind="error"
        title="予約結果を表示できませんでした"
        description={error || '予約した配信が見つかりませんでした。'}
        action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
      />
    )
  }

  if (!belongsToAccount(broadcast, selectedAccountId)) {
    return (
      <ListState
        kind="forbidden"
        title="選択中のアカウントの配信ではありません"
        description="上のアカウントを予約時のものへ切り替えてから、もう一度開いてください。"
        action={<Button href="/broadcasts">配信予定へ戻る</Button>}
      />
    )
  }

  if (broadcast.status !== 'scheduled' || !broadcast.scheduledAt) {
    return (
      <ListState
        kind="error"
        title="予約状態を確認できませんでした"
        description="この配信は予約待ちではありません。配信詳細で現在の状態を確認してください。"
        action={<Button href={`/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`}>配信詳細を見る</Button>}
      />
    )
  }

  const bubbleCount = broadcast.messageBubbles?.length ?? (broadcast.messageContent ? 1 : 0)
  const audienceCount = estimate?.audienceCount ?? null
  const audienceLabel = `${TARGET_LABELS[broadcast.targetType]}${audienceCount === null ? '' : ` ${audienceCount.toLocaleString('ja-JP')}人`}`
  const scheduledLabel = formatJst(broadcast.scheduledAt)
  const scheduledSentenceLabel = formatJstSentence(broadcast.scheduledAt)

  const testSend = async () => {
    if (actionBusy) return
    setActionBusy('test')
    setActionMessage('')
    setActionError('')
    try {
      const result = await api.broadcasts.testSend(broadcast.id)
      if (!result.success) throw new Error(result.error)
      setActionMessage(`テスト送信が完了しました（成功 ${result.sent ?? 0}件・失敗 ${result.failed ?? 0}件）。`)
    } catch {
      setActionError('テスト送信できませんでした。テスト送信先の設定と配信内容を確認してください。')
    } finally {
      setActionBusy(null)
    }
  }

  const duplicateBroadcast = async () => {
    if (actionBusy) return
    setActionBusy('duplicate')
    setActionMessage('')
    setActionError('')
    duplicateKey.current ??= crypto.randomUUID()
    try {
      const result = await api.broadcasts.create({
        title: `${broadcast.title}（複製）`,
        messageType: broadcast.messageType,
        messageContent: broadcast.messageContent,
        messageBubbles: broadcast.messageBubbles ?? undefined,
        targetType: broadcast.targetType,
        targetTagId: broadcast.targetTagId,
        lineAccountId: broadcast.lineAccountId,
        accountIds: broadcast.accountIds ?? undefined,
        dedupPriority: broadcast.dedupPriority ?? undefined,
        trackLinks: broadcast.trackLinks,
        segmentConditions: broadcast.segmentConditions ?? undefined,
        folderId: broadcast.folderId ?? null,
        measureOpens: broadcast.measureOpens,
      }, { idempotencyKey: duplicateKey.current })
      if (!result.success) throw new Error(result.error)
      router.push(`/broadcasts?id=${encodeURIComponent(result.data.id)}`)
    } catch {
      setActionError('複製できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <div data-design-node="bPF0s" className="space-y-4 pb-10">
      <Link href="/broadcasts" className="text-action hover:text-action-hover inline-flex text-sm font-semibold hover:underline">
        ← 一斉配信一覧
      </Link>

      <BroadcastStepRail steps={[
        { key: 'basic', order: 1, label: '基本設定', anchor: 'reservation-summary', state: 'done' },
        { key: 'audience', order: 2, label: '対象者', anchor: 'reservation-summary', state: 'done' },
        { key: 'message', order: 3, label: 'メッセージ', anchor: 'reservation-summary', state: 'done' },
        { key: 'schedule', order: 4, label: '送信設定', anchor: 'reservation-summary', state: 'done' },
        { key: 'confirm', order: 5, label: '確認', anchor: 'reservation-summary', state: 'done' },
      ]} />

      <div style={{ gridTemplateColumns: 'minmax(0, 1fr) 390px' }} className="grid items-start gap-4">
        <section id="reservation-summary" style={{ minHeight: 760 }} className="bg-canvas border-hairline rounded-card border px-6 py-8 text-center shadow-sm">
          <span className="bg-accent-soft text-accent mx-auto flex h-14 w-14 items-center justify-center rounded-full">
            <CalendarCheck2 size={28} aria-hidden="true" />
          </span>
          <h2 className="text-ink mt-5 text-xl font-bold">一斉配信を予約しました</h2>
          <p className="text-ink-secondary mt-3 text-sm font-semibold">
            {audienceCount === null
              ? `${scheduledSentenceLabel}に配信します。対象人数は現在確認できません。`
              : `${scheduledSentenceLabel}に、${audienceCount.toLocaleString('ja-JP')}人へ配信します。`}
          </p>

          <dl className="bg-canvas-sunken border-hairline mx-auto mt-5 max-w-3xl rounded-card border px-5 text-sm">
            {[
              ['管理名', broadcast.title],
              ['配信対象', audienceLabel],
              ['送信予定', scheduledLabel],
              ['状態', '予約中'],
            ].map(([label, value]) => (
              <div key={label} className="border-hairline flex items-center justify-between gap-6 border-b py-4 text-left last:border-b-0">
                <dt className="text-ink-faint shrink-0 font-semibold">{label}</dt>
                <dd className="text-ink min-w-0 truncate font-bold" title={value}>{value}</dd>
              </div>
            ))}
          </dl>

          <NoteBar className="mx-auto mt-4 max-w-3xl">
            {notificationText || '配信対象は送信開始直前に再集計します。現在の見込みは、友だちやタグの変化で予約時刻までに増減します。'}
          </NoteBar>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button href="/broadcasts"><List size={16} aria-hidden="true" />一覧へ戻る</Button>
            <Button variant="primary" href={`/broadcasts?id=${encodeURIComponent(broadcast.id)}`}>
              <Eye size={16} aria-hidden="true" />予約内容を確認
            </Button>
          </div>
        </section>

        <aside className="bg-canvas border-hairline rounded-card border p-4 shadow-sm">
          <h2 className="text-ink text-base font-bold">次にできること</h2>
          <p className="text-ink-faint mt-1 text-xs">予約後も開始前まで確認・取消できます。</p>
          <div className="mt-4 grid gap-2">
            <Button href={`/broadcasts?id=${encodeURIComponent(broadcast.id)}`} className="w-full">
              <Eye size={16} aria-hidden="true" />予約の内容を見る
            </Button>
            <Button onClick={() => void testSend()} disabled={actionBusy !== null} className="w-full">
              <Send size={16} aria-hidden="true" />{actionBusy === 'test' ? 'テスト送信中…' : 'テスト送信する'}
            </Button>
            <Button onClick={() => void duplicateBroadcast()} disabled={actionBusy !== null} className="w-full">
              <Copy size={16} aria-hidden="true" />{actionBusy === 'duplicate' ? '複製中…' : '複製して別配信を作る'}
            </Button>
            {broadcast.status === 'scheduled' && !cancelled && (
              <Button onClick={() => { setCancelError(''); setCancelOpen(true) }} disabled={actionBusy !== null} className="w-full">
                予約を取り消す
              </Button>
            )}
          </div>
          <p className="text-ink-faint mt-4 text-xs">配信内容: {bubbleCount}通</p>
          {estimate ? <p className="text-ink-faint mt-1 text-xs">除外見込み: {estimate.hiddenExcluded.toLocaleString('ja-JP')}人</p> : null}
          {actionMessage ? <p role="status" className="bg-success-bg text-success rounded-control mt-3 px-3 py-2 text-xs">{actionMessage}</p> : null}
          {actionError ? <p role="alert" className="bg-danger-bg text-danger rounded-control mt-3 px-3 py-2 text-xs">{actionError}</p> : null}
        </aside>
      </div>

      {estimate?.warnings.length ? (
        <section className="rounded-card border border-warning-bg bg-warning-bg p-4 text-sm text-warning">
          <p className="font-bold">配信前に確認すること</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {estimate.warnings.map((warning, index) => <li key={`${warning.level}-${index}`}>{warning.message}</li>)}
          </ul>
        </section>
      ) : null}

      {cancelled && (
        <p className="bg-success-bg text-success rounded-card px-4 py-3 text-sm">
          予約を取り消しました。内容は下書きとして残っています。
        </p>
      )}

      <ConfirmDialog
        open={cancelOpen}
        title={`「${broadcast.title}」の予約を取り消しますか？`}
        description="予約が取り消され、この配信は送られなくなります。書いた内容は下書きとして残るので、作り直しにはなりません。送信が始まったあとは取り消せません。"
        confirmLabel="予約を取り消す"
        destructive
        busy={cancelling}
        error={cancelError || undefined}
        onCancel={() => {
          if (cancelling) return
          setCancelOpen(false)
        }}
        onConfirm={async () => {
          if (cancelling) return
          setCancelling(true)
          setCancelError('')
          try {
            const res = await api.broadcasts.cancelReservation(broadcast.id)
            if (!res.success) throw new Error(res.error)
            setBroadcast(res.data)
            setCancelled(true)
            setCancelOpen(false)
          } catch {
            /*
              **口の返事をそのまま出さない。** 409（もう予約中ではない）も
              通信の失敗も、運用者にできることは同じ——読み直して確かめる。
            */
            setCancelError('予約を取り消せませんでした。すでに送信が始まっているかもしれません。状態を読み直してから、もう一度お試しください。')
          } finally {
            setCancelling(false)
          }
        }}
      >
        <dl className="text-ink-secondary space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-ink-faint shrink-0">配信日時</dt>
            <dd className="min-w-0">{formatJst(broadcast.scheduledAt)}</dd>
          </div>
        </dl>
      </ConfirmDialog>
      <style jsx global>{`
        [data-design-node='bPF0s'] > nav[aria-label='配信作成の進み'] {
          margin-bottom: 1.5rem;
          border: 0;
          border-radius: 0;
          background: transparent;
          padding: 0;
        }
      `}</style>
    </div>
  )
}

export default function ReservedBroadcastPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="予約結果を確認しています" />}>
      <ReservedBroadcastContent />
    </Suspense>
  )
}
