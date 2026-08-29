'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CalendarCheck2, Check, Eye, List, XCircle } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
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
  const router = useRouter()
  const id = useSearchParams().get('id')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const load = useCallback(async () => {
    if (!id) {
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
        if (preflight.success) setEstimate(preflight.data)
      } catch {
        setEstimate(null)
      }
    } catch {
      setBroadcast(null)
      setError('予約した配信を表示できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [id])

  const cancelReservation = async () => {
    if (!broadcast) return
    setCancelling(true)
    setCancelError('')
    try {
      const result = await api.broadcasts.cancelReservation(broadcast.id)
      if (!result.success) {
        setCancelError(
          result.error?.includes('no longer scheduled') || result.error?.includes('Only scheduled')
            ? '予約の状態が変わっています。画面を読み直して確認してください。'
            : '予約を取り消せませんでした。状態を読み直して、もう一度お試しください。',
        )
        return
      }
      setCancelOpen(false)
      router.replace(`/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`)
    } catch {
      setCancelError('予約を取り消せませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setCancelling(false)
    }
  }

  useEffect(() => {
    void load()
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

  const targetSummary = estimate
    ? `${TARGET_LABELS[broadcast.targetType]} ${estimate.audienceCount.toLocaleString('ja-JP')}人`
    : `${TARGET_LABELS[broadcast.targetType]}（人数は未取得）`
  const steps = ['基本設定', '対象者', 'メッセージ', '送信設定', '確認']

  return (
    <div data-design-node="bPF0s" className="space-y-5 pb-10">
      <Link href="/broadcasts" className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">
        <ArrowLeft size={16} aria-hidden="true" />一斉配信一覧
      </Link>

      <ol aria-label="配信予約の進み具合" className="grid grid-cols-2 gap-3 rounded-card bg-canvas px-5 py-4 shadow-sm sm:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-2 text-xs font-bold text-ink">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"><Check size={15} aria-hidden="true" /></span>
            <span><span className="block text-xs text-accent">STEP {index + 1}</span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="broadcast-reserved-grid grid items-start gap-5">
        <section className="broadcast-reserved-success rounded-card border border-hairline bg-canvas px-6 py-8 text-center shadow-sm">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
            <CalendarCheck2 size={30} aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-ink">一斉配信を予約しました</h2>
          <p className="mt-3 text-sm font-semibold text-ink-secondary">
            {formatJst(broadcast.scheduledAt)}に、{estimate ? `${estimate.audienceCount.toLocaleString('ja-JP')}人` : '人数を送信前に再集計して'}へ配信します。
          </p>

          <dl className="mx-auto mt-6 max-w-3xl rounded-card border border-hairline bg-canvas-sunken px-5 text-sm">
            {[
              ['管理名', broadcast.title],
              ['配信対象', targetSummary],
              ['送信予定', formatJst(broadcast.scheduledAt)],
              ['状態', '予約中'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-6 border-b border-hairline py-4 last:border-b-0">
                <dt className="shrink-0 font-semibold text-ink-faint">{label}</dt>
                <dd className="text-right font-bold text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mx-auto mt-5 max-w-3xl text-left">
            <NoteBar>
              配信対象は、送信を始める直前に同じ条件でもう一度数えます。現在の見込みから増減することがあります。
            </NoteBar>
          </div>

          {estimate?.warnings.length ? (
        <section className="rounded-card border border-warning-bg bg-warning-bg p-4 text-sm text-warning">
          <p className="font-bold">配信前に確認すること</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {estimate.warnings.map((warning, index) => <li key={`${warning.level}-${index}`}>{warning.message}</li>)}
          </ul>
        </section>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button href="/broadcasts" variant="secondary"><List size={16} aria-hidden="true" />一覧へ戻る</Button>
            <Button href={`/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`} variant="primary"><Eye size={16} aria-hidden="true" />予約内容を確認</Button>
          </div>
        </section>

        <aside className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
          <h2 className="text-base font-bold text-ink">次にできること</h2>
          <p className="mt-1 text-xs text-ink-faint">配信開始前までは内容を確認し、予約を取り消せます。</p>
          <div className="mt-4 grid gap-2">
            <Link href={`/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`} className="flex min-h-10 items-center gap-3 rounded-control bg-canvas-sunken px-3 text-sm font-semibold text-ink hover:bg-accent-soft"><Eye className="text-accent" size={16} aria-hidden="true" />予約内容を見る</Link>
            <Link href="/broadcasts" className="flex min-h-10 items-center gap-3 rounded-control bg-canvas-sunken px-3 text-sm font-semibold text-ink hover:bg-accent-soft"><List className="text-accent" size={16} aria-hidden="true" />配信予定を見る</Link>
            <button type="button" className="flex min-h-10 items-center gap-3 rounded-control bg-canvas-sunken px-3 text-left text-sm font-semibold text-ink hover:bg-danger-bg" onClick={() => { setCancelError(''); setCancelOpen(true) }}><XCircle className="text-accent" size={16} aria-hidden="true" />予約を取り消す</button>
          </div>
          <p className="mt-4 text-xs leading-5 text-ink-faint">取り消しても配信内容は下書きとして残ります。内容を直して、改めて予約できます。</p>
        </aside>
      </div>

      <style jsx>{`
        .broadcast-reserved-success { min-height: 650px; }
        @media (min-width: 1280px) {
          .broadcast-reserved-grid { grid-template-columns: minmax(0, 1fr) 390px; }
        }
      `}</style>

      <ConfirmDialog
        open={cancelOpen}
        title="この配信の予約を取り消しますか？"
        description="送信予定から外し、配信内容は下書きとして残します。友だちには送信しません。"
        confirmLabel="予約を取り消す"
        busy={cancelling}
        error={cancelError}
        onConfirm={() => void cancelReservation()}
        onCancel={() => {
          if (cancelling) return
          setCancelError('')
          setCancelOpen(false)
        }}
      >
        <dl className="rounded-card border border-hairline bg-canvas-sunken px-4 text-sm">
          <div className="flex justify-between gap-4 border-b border-hairline py-3"><dt className="text-ink-faint">管理名</dt><dd className="text-right font-semibold text-ink">{broadcast.title}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="text-ink-faint">送信予定</dt><dd className="text-right font-semibold text-ink">{formatJst(broadcast.scheduledAt)}</dd></div>
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
