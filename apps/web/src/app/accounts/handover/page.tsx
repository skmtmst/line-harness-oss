'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import {
  api,
  type AccountHandover,
  type AccountHandoverDecision,
} from '@/lib/api'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import { TableHeadRow, Th } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  DIFFERENT_PROVIDER_NOTE,
  HANDOVER_STEPS,
  MATCH_BUCKETS,
  totalsMatch,
} from './handover-view'

type HandoverDecisionView = AccountHandoverDecision & {
  sourceName?: string
  candidateName?: string | null
  evidenceLabel?: string
}

type HandoverView = AccountHandover & {
  decisions: HandoverDecisionView[]
  unresolvedReviews: number | null
}

const statusStep: Record<AccountHandover['status'], number> = {
  code_issued: 1,
  linked: 2,
  previewed: 3,
  resolved: 4,
  executing: 5,
  completed: 5,
  failed: 5,
  cancelled: 1,
}

function formatMonthDayTime(value: string | null): string {
  if (!value) return '未取得'
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

/** LINEアカウントの乗り換え・引き継ぎ。設計 ★V6 33-4（`nx3XW`）。 */
function Handover() {
  const search = useSearchParams()
  const id = search?.get('id') ?? ''
  const [account, setAccount] = useState<LineAccount | null>(null)
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [handover, setHandover] = useState<HandoverView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [refreshing, setRefreshing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executeError, setExecuteError] = useState('')
  const [executeMessage, setExecuteMessage] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setStatus('loading')
    try {
      const [accountRes, accountsRes, handoversRes] = await Promise.all([
        api.lineAccounts.get(id),
        api.lineAccounts.list(),
        api.accountHandovers.listForAccount(id),
      ])
      if (!accountRes.success || !accountsRes.success || !handoversRes.success) {
        setStatus('error')
        return
      }
      setAccount(accountRes.data)
      setAccounts(accountsRes.data)
      const current = handoversRes.data[0]
      if (!current) {
        setHandover(null)
        setStatus('ready')
        return
      }
      const detailRes = await api.accountHandovers.get(current.id)
      if (!detailRes.success) {
        setStatus('error')
        return
      }
      setHandover(detailRes.data as HandoverView)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [id])

  useEffect(() => { void load() }, [load])
  usePageTitle('乗り換え・引き継ぎ')

  const destination = useMemo(
    () => accounts.find((item) => item.id === handover?.toAccountId) ?? null,
    [accounts, handover?.toAccountId],
  )
  const countsAreComplete = handover?.counts
    ? totalsMatch(handover.counts, handover.counts.sourceTotal)
    : false

  const rerunPreview = async () => {
    if (!handover?.counts || !countsAreComplete) return
    setRefreshing(true)
    try {
      const { sourceTotal, auto, review, unmatched, lookalike } = handover.counts
      const result = await api.accountHandovers.preview(handover.id, {
        sourceFriendTotal: sourceTotal,
        counts: { auto, review, unmatched, lookalike },
      })
      if (!result.success) return
      const detail = await api.accountHandovers.get(handover.id)
      if (detail.success) setHandover(detail.data as HandoverView)
    } finally {
      setRefreshing(false)
    }
  }

  const copyCode = async () => {
    if (!handover?.code) return
    await navigator.clipboard.writeText(handover.code)
    setCopyState('copied')
  }

  /**
   * 段5。本実行。**確認窓なしでは進めない。**
   * 決め残し・実行ずみは口側でも止めるが、画面でも押せない形にする。
   */
  const executeHandover = async () => {
    if (!handover || executing) return
    setExecuting(true)
    setExecuteError('')
    setExecuteMessage('')
    try {
      const result = await api.accountHandovers.execute(handover.id)
      if (!result.success) {
        setExecuteError(result.error)
        return
      }
      setConfirmOpen(false)
      const detail = await api.accountHandovers.get(handover.id)
      if (detail.success) setHandover(detail.data as HandoverView)
      const moved = result.data.movedCount ?? result.data.plannedCount ?? 0
      setExecuteMessage(
        result.data.failureReason
          ?? `本実行が終わりました。${moved.toLocaleString('ja-JP')}人を移しました。`,
      )
    } catch {
      setExecuteError('本実行できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setExecuting(false)
    }
  }

  if (status === 'loading') return <ListState kind="loading" />
  if (status === 'error' || !account) {
    return (
      <ListState
        kind="error"
        action={<Button type="button" onClick={() => void load()}>再読み込み</Button>}
      />
    )
  }
  if (!handover) {
    return (
      <ListState
        kind="empty"
        title="進行中の引き継ぎはありません"
        description="引き継ぎコードを発行すると、事前確認の結果をここで確かめられます。"
        action={<Button href={`/accounts/detail?id=${account.id}`}>アカウントの詳細へ戻る</Button>}
      />
    )
  }

  const currentStep = statusStep[handover.status]

  return (
    <div data-design-node="nx3XW">
      <div data-design="Head" className="mb-4">
        <Breadcrumb items={[
          { label: 'LINEアカウント', href: '/accounts' },
          { label: account.name, href: `/accounts/detail?id=${account.id}` },
          { label: '乗り換え' },
        ]} />
      </div>

      <ol className="grid gap-2 lg:grid-cols-5">
        {HANDOVER_STEPS.map((step) => {
          const completed = step.order < currentStep
          const active = step.order === currentStep
          return (
            <li key={step.order} className="border-hairline bg-canvas rounded-control flex min-w-0 items-center gap-3 border p-3">
              <span className={completed
                ? 'bg-success text-on-accent flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold'
                : active
                  ? 'bg-action text-on-accent flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold'
                  : 'bg-canvas-sunken text-ink-secondary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold'}>
                {completed ? '✓' : step.order}
              </span>
              <span className="min-w-0">
                <span className="text-ink-faint block text-xs font-bold">STEP {step.order}</span>
                <span className="text-ink block text-xs font-medium leading-relaxed">{step.label}</span>
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mt-4 grid gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-base font-bold">どこからどこへ</p>
            <p className="text-ink-secondary mt-1 text-xs">引き継ぎコードで両方のアカウントをつなぎました。</p>
            <div className="mt-3 overflow-hidden rounded-control border border-hairline">
              <div
                className="grid text-sm"
                style={{ gridTemplateColumns: '7rem minmax(0, 1fr) minmax(0, 1fr)' }}
              >
                <div className="bg-canvas-sunken border-hairline border-b px-3 py-2 text-xs font-bold">アカウント</div>
                <div className="border-hairline border-b border-l px-3 py-2">{account.name}（{account.channelId}）</div>
                <div className="border-hairline border-b border-l px-3 py-2">{destination ? `${destination.name}（${destination.channelId}）` : '未取得'}</div>
                <div className="bg-canvas-sunken px-3 py-2 text-xs font-bold">プロバイダー</div>
                <div className="border-hairline border-l px-3 py-2">乗り換え元</div>
                <div className="border-hairline border-l px-3 py-2">受け取り先</div>
              </div>
            </div>
            {handover.providerMatch === 'different' && (
              <div className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs leading-relaxed">
                <p className="font-bold">プロバイダーが違うので、友だちのIDは自動でつなげません</p>
                <p className="mt-1">{DIFFERENT_PROVIDER_NOTE.replace('プロバイダーが違うので、友だちのIDは自動でつなげません。', '')}</p>
              </div>
            )}
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-base font-bold">事前確認の結果</p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              本実行はしていません。ここで止めても、元のアカウントは何も変わりません。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {MATCH_BUCKETS.map((bucket) => (
                <div key={bucket.key} className="border-hairline rounded-card border p-4">
                  <p className="text-ink-faint text-xs">{bucket.label}</p>
                  <p className="text-ink mt-1 text-2xl font-semibold">
                    {countsAreComplete ? `${handover.counts?.[bucket.key].toLocaleString('ja-JP')}人` : '—'}
                  </p>
                  <p className="text-ink-faint mt-1 text-xs">{bucket.note}</p>
                </div>
              ))}
            </div>
            <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
              {countsAreComplete && handover.counts
                ? `元の友だち ${handover.counts.sourceTotal}人 ＝ 自動で一致 ${handover.counts.auto} ＋ 要確認 ${handover.counts.review} ＋ 一致しない ${handover.counts.unmatched} ＋ 別人の可能性 ${handover.counts.lookalike}`
                : '4区分の合計を確認できないため、人数は表示していません。'}
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="border-hairline border-b px-5 py-4">
              <p className="text-ink text-base font-bold">人が決める {handover.counts?.review ?? '—'}人</p>
              <p className="text-ink-secondary mt-1 text-xs">「要確認」を全部決めるまで本実行できません。決めた内容はあとから見返せます。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-left">
                <thead>
                  <TableHeadRow>
                    <Th>元の友だち</Th>
                    <Th>受け取り先の候補</Th>
                    <Th>つないだ根拠</Th>
                    <Th>どうする</Th>
                  </TableHeadRow>
                </thead>
                <tbody className="divide-hairline divide-y">
                  {handover.decisions.map((decision) => (
                    <tr key={decision.id} className="text-sm">
                      <td className="px-4 py-3 font-medium">{decision.sourceName ?? decision.from_friend_id}</td>
                      <td className="px-4 py-3">{decision.candidateName ?? '候補なし'}</td>
                      <td className="text-ink-secondary px-4 py-3 text-xs">{decision.evidenceLabel ?? decision.note ?? '未取得'}</td>
                      <td className="px-4 py-3">
                        <span className="border-hairline rounded-full border px-2 py-1 text-xs">
                          {decision.decision === 'link' ? '同じ人' : decision.decision === 'new' ? '新しく作る' : '引き継がない'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-ink-secondary border-hairline border-t px-5 py-3 text-xs">
              残り {handover.unresolvedReviews ?? '—'}人。名前と画像だけの一致では、自動で同じ人にしません。
            </p>
          </section>

          {executeMessage && (
            <p role="status" className="bg-success-bg text-success rounded-control mt-3 p-3 text-xs leading-relaxed">
              {executeMessage}
            </p>
          )}
          {executeError && (
            <p role="alert" className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs leading-relaxed">
              {executeError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button href={`/accounts/detail?id=${account.id}`}>やめる</Button>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={refreshing || !countsAreComplete} onClick={() => void rerunPreview()}>
                {refreshing ? '確認中…' : '事前確認をやり直す'}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={(handover.unresolvedReviews ?? 1) > 0}
                onClick={() => { setExecuteError(''); setExecuteMessage(''); setConfirmOpen(true) }}
              >
                {executing ? '実行中…' : '本実行へ進む'}
              </Button>
            </div>
          </div>
          <ConfirmDialog
            open={confirmOpen}
            title="本実行しますか？"
            description={`要確認はすべて決めました。本実行すると、決めた内容で友だちが「${destination?.name ?? '受け取り先'}」へ移ります。元のアカウントの友だち・履歴・配信は消しません。`}
            confirmLabel={executing ? '実行中…' : '本実行する'}
            busy={executing}
            error={executeError}
            onConfirm={() => void executeHandover()}
            onCancel={() => { if (!executing) { setConfirmOpen(false); setExecuteError('') } }}
          />
        </div>

        <aside className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">引き継ぎコード</p>
            <div className="bg-canvas-sunken rounded-control mt-3 p-4 text-center">
              <p className="text-ink text-xl font-bold tracking-wider">{handover.code}</p>
              <Button type="button" className="mt-3" onClick={() => void copyCode()}>
                {copyState === 'copied' ? 'コピーしました' : 'コピー'}
              </Button>
            </div>
            <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
              受け取り先のアカウントでこのコードを読むと、つながります。期限は発行から24時間です。
            </p>
            <p className="text-ink-faint mt-2 text-xs">読み終わりました（{formatMonthDayTime(handover.linkedAt)}）。</p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">戻せること</p>
            <ul className="text-ink-secondary mt-2 space-y-2 text-xs leading-relaxed">
              <li>・本実行しても、元のアカウントの友だち・履歴・配信は消しません。</li>
              <li>・引き継いだ先の内容は、実行から30日以内なら戻せます。</li>
              <li>・戻すときも、友だちのつなぎ方だけを元に戻します。</li>
            </ul>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">気をつけること</p>
            <ul className="text-ink-secondary mt-2 space-y-2 text-xs leading-relaxed">
              <li>・送信を止める設定と同意状態は、厳しいほうを引き継ぎます。</li>
              <li>・名前と画像だけが似ている組は、自動では同じ人にしません。</li>
              <li>・本実行の前に、控えと戻し先の目印を作ります。</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default function HandoverPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <Handover />
    </Suspense>
  )
}
