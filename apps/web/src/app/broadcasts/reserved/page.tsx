'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
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

function belongsToAccount(broadcast: ApiBroadcast, selectedAccountId: string | null): boolean {
  if (!selectedAccountId) return true
  if (broadcast.targetType === 'multi-account-dedup') {
    return broadcast.accountIds?.includes(selectedAccountId) ?? false
  }
  return broadcast.lineAccountId === selectedAccountId
}

function ReservedBroadcastContent() {
  usePageTitle('配信予約・完了')
  const id = useSearchParams().get('id')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null)
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

  return (
    <div data-design-node="bPF0s" className="space-y-5 pb-10">
      <section className="rounded-card border border-hairline bg-canvas px-6 py-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto text-accent" size={42} aria-hidden="true" />
        <p className="mt-3 text-xl font-bold text-ink">配信を予約しました</p>
        <p className="mt-2 text-sm text-ink-secondary">{broadcast.title}</p>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          variant="v6"
          title="現在の配信見込み"
          value={estimate?.audienceCount ?? null}
          unit="人"
          detail={estimate ? 'いま同じ条件で数えた人数' : '現在の人数を確認できませんでした'}
        />
        <SummaryCard
          variant="v6"
          title="現在の除外見込み"
          value={estimate?.hiddenExcluded ?? null}
          unit="人"
          detail={estimate ? 'ブロック・非表示などを除外' : '現在の除外人数を確認できませんでした'}
        />
        <SummaryCard
          variant="v6"
          title="配信内容"
          value={bubbleCount}
          unit="個"
          detail="LINEに届く吹き出し"
        />
      </div>

      <section className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
        <h2 className="text-base font-bold text-ink">予約した内容</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-ink-faint">予約日時</dt>
            <dd className="mt-1 font-bold text-ink">{formatJst(broadcast.scheduledAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-faint">送る相手</dt>
            <dd className="mt-1 font-bold text-ink">{TARGET_LABELS[broadcast.targetType]}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-faint">リンクのクリック計測</dt>
            <dd className="mt-1 font-bold text-ink">{broadcast.trackLinks ? '計測する' : '計測しない'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-faint">開封数の集計</dt>
            <dd className="mt-1 font-bold text-ink">{broadcast.measureOpens === false ? '集計しない' : '集計する'}</dd>
          </div>
        </dl>
      </section>

      <NoteBar>
        配信対象は、送信を始める直前に同じ条件でもう一度数えます。上の人数は現在の見込みなので、友だちやタグの変化によって予約時刻までに増減します。
      </NoteBar>

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

      <div className="flex flex-wrap justify-center gap-3">
        <Button href={`/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`}>予約内容を確認</Button>
        <Button href="/broadcasts">配信予定へ戻る</Button>
        {/*
          **取り消せるのは、まだ送り始めていない予約だけ。**
          送信中・送信済みに出すと、押せるのに409で断られる。
        */}
        {broadcast.status === 'scheduled' && !cancelled && (
          <Button
            onClick={() => { setCancelError(''); setCancelOpen(true) }}
          >
            予約を取り消す
          </Button>
        )}
      </div>

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
