'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import { ApiError, api, type ApiBroadcast, type BroadcastInsight, type BroadcastApprovalState } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Progress from '@/components/shared/progress'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import {
  ApprovalBadge,
  ApprovalRequestFields,
  ApprovalStatusSection,
  ApproverSection,
  formatApprovalDateTime,
} from '@/components/broadcasts/broadcast-approval'
import type { BroadcastApprovalCandidate } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { audienceSummary, messageTypeLabel } from '@/lib/broadcast-summary'
import { broadcastBelongsToSelectedAccount } from './broadcast-detail-account'
import { clickInsightDetail, formatBroadcastDateTime, openInsightDetail } from './broadcast-insight-display'
import { broadcastDetailCsv } from './broadcast-detail-export'
import { broadcastCsvFilename } from '@/components/broadcasts/broadcast-csv-filename'
import { usePageTitle } from '@/components/shell/page-chrome'

function BroadcastDetailInner() {
  const params = useSearchParams()
  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  const id = params.get('id') ?? ''
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  usePageTitle(broadcast ? `配信結果：${broadcast.title}` : '配信の詳細')
  const [insight, setInsight] = useState<(BroadcastInsight & { suppressedByAudienceSize: boolean }) | null>(null)
  // 集計は配信本体とは別に取る。取れていないのか、取りに行って失敗したのかを
  // 「—」に混ぜると、待てば出るのか操作が要るのかを運用者が判断できない。
  const [insightState, setInsightState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [reloadToken, setReloadToken] = useState(0)
  // BROADCAST-15: 宛先の条件に出すタグ名・シナリオ名。配信本体とは別に取る。
  // 読み込めないことと、宛先が消えていることは分けて出す。
  const [audienceNameState, setAudienceNameState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [audienceNames, setAudienceNames] = useState<{
    tags: Tag[]
    scenarios: Array<{ id: string; name: string }>
  }>({ tags: [], scenarios: [] })
  const contentRef = useRef<HTMLElement>(null)
  /*
   * 二者承認（m12a / 設計 A-2・A-3）。配信本体とは別に読む。
   * 取れなくても配信の詳細は出し続ける（承認の欄だけ出さない）。
   */
  const [approvalState, setApprovalState] = useState<BroadcastApprovalState | null>(null)
  const [approvalCandidates, setApprovalCandidates] = useState<BroadcastApprovalCandidate[]>([])
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null)
  // 承認の依頼を出し直すときの入力（差し戻し・期限切れのあと）。
  const [reApproverId, setReApproverId] = useState('')
  const [reApprovalNote, setReApprovalNote] = useState('')

  const exportCsv = () => {
    if (!broadcast) return
    const csv = broadcastDetailCsv({
      title: broadcast.title,
      status: broadcast.status,
      sentAt: broadcast.sentAt,
      scheduledAt: broadcast.scheduledAt,
      totalCount: broadcast.totalCount,
      successCount: broadcast.successCount,
      delivered: insight?.delivered ?? null,
      uniqueImpression: insight?.uniqueImpression ?? null,
      uniqueClick: insight?.uniqueClick ?? null,
    }, formatBroadcastDateTime)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = broadcastCsvFilename(broadcast.title, broadcast.id)
    link.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    let active = true
    setBroadcast(null)
    setInsight(null)
    setInsightState('loading')
    setLoadState('loading')
    if (!id || accountLoading) {
      return
    }
    if (!selectedAccountId) {
      setLoadState('not-found')
      return
    }
    setAudienceNameState('idle')
    void (async () => {
      try {
        const detail = await api.broadcasts.get(id)
        if (!active) return
        if (!detail.success || !broadcastBelongsToSelectedAccount(detail.data, selectedAccountId)) {
          setLoadState('not-found')
          return
        }

        setBroadcast(detail.data)
        setLoadState('ready')

        // 二者承認の今の状態。取れなくても詳細は出す。
        setApprovalState(null)
        setApprovalMessage(null)
        void api.broadcasts.approval.get(id).then((approvalRes) => {
          if (!active) return
          if (approvalRes.success) {
            setApprovalState(approvalRes.data)
            // 承認する人・頼み直す人の名前を出すため、候補も読む。
            if (selectedAccountId) {
              void api.broadcasts.approval.candidates(selectedAccountId).then((candidatesRes) => {
                if (!active) return
                if (candidatesRes.success) setApprovalCandidates(candidatesRes.data)
              }).catch(() => undefined)
            }
          }
        }).catch(() => undefined)

        // 宛先が絞り込みのときだけ、条件に出すタグ名・シナリオ名を取る。
        // 取れなくても配信の詳細は出し続ける。
        const needsAudienceNames =
          detail.data.targetType !== 'all' && detail.data.targetType !== 'multi-account-dedup'
        if (needsAudienceNames) {
          setAudienceNameState('loading')
          void Promise.allSettled([api.tags.list(), api.scenarios.list()])
            .then(([tagsRes, scenariosRes]) => {
              if (!active) return
              const tags = tagsRes.status === 'fulfilled' && tagsRes.value.success ? tagsRes.value.data : null
              const scenarios = scenariosRes.status === 'fulfilled' && scenariosRes.value.success ? scenariosRes.value.data : null
              if (!tags && !scenarios) {
                setAudienceNameState('error')
                return
              }
              setAudienceNames({ tags: tags ?? [], scenarios: scenarios ?? [] })
              setAudienceNameState('ready')
            })
        }

        // 詳細画面は送信日が30日より前でも開く。期間集計ではなく、
        // この配信自身の保存済みインサイトを読む。
        try {
          const stats = await api.broadcasts.getInsight(id)
          if (!active) return
          if (stats.success && stats.data) {
            setInsight({
              ...stats.data,
              suppressedByAudienceSize:
                stats.data.uniqueImpression == null
                && (stats.data.delivered ?? 0) > 0
                && (stats.data.delivered ?? 0) < 20,
            })
            setInsightState('ready')
          } else if (stats.success) {
            // 200 で data が null。まだLINEから集計が返っていない。
            setInsightState('ready')
          } else {
            setInsightState('error')
          }
        } catch {
          // 配信本体は読めている。集計だけ落ちたことを、未取得と分けて出す。
          if (active) setInsightState('error')
        }
      } catch (error) {
        if (!active) return
        setLoadState(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error')
      }
    })()
    return () => {
      active = false
    }
  }, [accountLoading, id, reloadToken, selectedAccountId])

  /*
   * 送信中は5秒ごとに配信を取り直し、進み具合と成功件数を更新する。
   * 送信中に開いた人が止まった数字を見続けないようにする。
   * 送り終わった・失敗した・画面を離れたら止める。
   */
  useEffect(() => {
    if (!id || broadcast?.status !== 'sending') return
    let active = true
    const timer = setInterval(() => {
      void (async () => {
        try {
          const detail = await api.broadcasts.get(id)
          if (!active || !detail.success) return
          if (detail.data.status !== 'sending') {
            // 状態が変わったら全体を取り直して集計も更新する。
            setReloadToken((value) => value + 1)
          }
          setBroadcast((prev) => (prev && prev.id === id ? detail.data : prev))
        } catch {
          // 失敗は数えず、次の周期で取り直す。
        }
      })()
    }, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [id, broadcast?.status])

  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見る配信が指定されていません"
        description="一覧から、見たい配信を選び直してください。"
        backHref="/broadcasts"
        backLabel="一斉配信の一覧へ戻る"
      />
    )
  }

  if (loadState === 'error') {
    return (
      <TargetMissing
        kind="error"
        title="配信を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => setReloadToken((value) => value + 1)}
      />
    )
  }

  if (loadState === 'not-found' || (loadState === 'ready' && !broadcast)) {
    if (!selectedAccountId) {
      // アカウント未選択は対象の有無とは別の状態。他の画面と同じく ListState で出す。
      return (
        <ListState
          kind="empty"
          title="LINE公式アカウントを選んでください"
          description="選ぶと配信を確認できます。"
          action={<Button href="/broadcasts">一斉配信の一覧へ戻る</Button>}
        />
      )
    }
    return (
      <TargetMissing
        kind="not-found"
        title="この配信は見つかりません"
        description="このLINEアカウントで確認できる配信は見つかりませんでした。削除されたか、一覧から選び直してください。"
        accountName={selectedAccount?.name}
        backHref="/broadcasts"
        backLabel="一斉配信の一覧へ戻る"
      />
    )
  }

  const total = broadcast?.totalCount ?? 0
  const success = broadcast?.successCount ?? 0
  const failed = Math.max(0, total - success)
  const pct = (n: number, base: number) =>
    base > 0 ? `${Math.round((n / base) * 1000) / 10}%` : '—'

  // BROADCAST-15: 宛先の条件は一覧・配信詳細パネルと同じ audienceSummary。
  // 名前を読み込む間は「確認中」、読めないときは失敗と分かる言い方にする。
  const tagNameById = (tagId: string) => audienceNames.tags.find((t) => t.id === tagId)?.name ?? null
  const scenarioNameById = (scenarioId: string) =>
    audienceNames.scenarios.find((s) => s.id === scenarioId)?.name ?? null
  const audienceLabel = !broadcast
    ? ''
    : broadcast.targetType === 'all' || broadcast.targetType === 'multi-account-dedup'
      ? audienceSummary(broadcast, tagNameById)
      : audienceNameState === 'ready'
        ? audienceSummary(broadcast, tagNameById, scenarioNameById)
        : audienceNameState === 'error'
          ? '宛先の条件を確認できませんでした'
          : '宛先の条件を確認しています…'

  /*
   * 二者承認の操作（設計 A-2・A-3）。終わったら状態を読み直す。
   * 承認して送るは、承認のあと送る操作まで続ける。
   */
  const reloadApproval = async () => {
    if (!id) return
    try {
      const res = await api.broadcasts.approval.get(id)
      if (res.success) setApprovalState(res.data)
    } catch {
      // 読み直しの失敗は黙って次へ。帯の文は古いまま残る。
    }
  }
  const runApprovalAction = async (
    action: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    if (approvalBusy) return
    setApprovalBusy(true)
    setApprovalMessage(null)
    try {
      const res = await action()
      if (!res.success) {
        setApprovalMessage(res.error ?? '操作できませんでした。')
        return
      }
      await reloadApproval()
    } catch {
      setApprovalMessage('操作できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setApprovalBusy(false)
    }
  }
  const handleApprovalCancel = () => void runApprovalAction(() => api.broadcasts.approval.cancel(id))
  const handleApprovalRemind = () => void runApprovalAction(() => api.broadcasts.approval.remind(id))
  const handleApprovalReject = (reason: string) =>
    void runApprovalAction(() => api.broadcasts.approval.reject(id, reason))
  const handleApprovalApprove = () =>
    void (async () => {
      if (approvalBusy) return
      setApprovalBusy(true)
      setApprovalMessage(null)
      try {
        const approved = await api.broadcasts.approval.approve(id)
        if (!approved.success) {
          setApprovalMessage(approved.error)
          return
        }
        // 予約なし（今すぐ送る分）は、承認のあと既存の送信の流れへ渡す。
        if (approved.data?.needsSend) {
          const sent = await api.broadcasts.send(id)
          if (!sent.success) {
            setApprovalMessage(`承認しましたが、送信できませんでした。${sent.error}`)
            await reloadApproval()
            return
          }
          setReloadToken((value) => value + 1)
          return
        }
        await reloadApproval()
      } catch {
        setApprovalMessage('操作できませんでした。状態を読み直してから、もう一度お試しください。')
      } finally {
        setApprovalBusy(false)
      }
    })()
  const handleApprovalRequest = () =>
    void (async () => {
      if (approvalBusy) return
      if (!reApproverId) {
        setApprovalMessage('承認をお願いする人を選んでください')
        return
      }
      setApprovalBusy(true)
      setApprovalMessage(null)
      try {
        const requested = await api.broadcasts.approval.request(id, {
          approverStaffId: reApproverId,
          note: reApprovalNote.trim() || undefined,
        })
        if (!requested.success) {
          setApprovalMessage(requested.error)
          return
        }
        setReApproverId('')
        setReApprovalNote('')
        await reloadApproval()
      } catch {
        setApprovalMessage('依頼できませんでした。状態を読み直してから、もう一度お試しください。')
      } finally {
        setApprovalBusy(false)
      }
    })()
  const approvalRequesterName = approvalState?.approval.requestedByStaffId
    ? (approvalCandidates.find((item) => item.id === approvalState.approval.requestedByStaffId)?.name ?? null)
    : null
  const approvalApproverName = approvalState?.approval.approverStaffId
    ? (approvalCandidates.find((item) => item.id === approvalState.approval.approverStaffId)?.name ?? null)
    : null
  const approvalMessageSummary = broadcast?.messageBubbles && broadcast.messageBubbles.length > 0
    ? `${broadcast.messageBubbles.length}通`
    : null
  // 差し戻し・期限切れ・取り消しのあと、頼み直せる条件。
  const canReRequest = broadcast
    && approvalState
    && approvalState.gate.required
    && !approvalState.gate.singleOperator
    && (broadcast.status === 'draft' || broadcast.status === 'scheduled')
    && ['none', 'rejected', 'cancelled', 'expired'].includes(approvalState.approval.status)

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-4 text-xs">
        <Link href="/broadcasts" className="hover:underline">
          ← 一斉配信一覧
        </Link>
      </nav>

      {/*
        ★V7 `x63W5x`：読み込み中は一覧の場所に ListState loading を1つ。
        素の「読み込み中...」は出さない。
      */}
      {loadState === 'loading' || !broadcast ? (
        <ListState kind="loading" title="配信を読み込んでいます" />
      ) : String(broadcast.status) === 'sent' ? (
        <SentResult broadcast={broadcast} insight={insight} insightState={insightState} contentRef={contentRef} />
      ) : (
        <div className="space-y-4">
          {/*
            二者承認（設計 A-2）。配信の題の横に承認待ちの札を出す。
            題自体は枠の見出しに出るので、ここでは札と並べるだけにする。
          */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-ink text-base font-bold">{broadcast.title}</p>
            <ApprovalBadge status={broadcast.approvalStatus} />
          </div>
          {/*
            二者承認（設計 A-2・A-3）。承認待ちの帯と、承認する人の操作。
            差し戻し・期限切れのあとは頼み直す欄を出す。
          */}
          {approvalState ? (
            <ApprovalStatusSection
              approval={approvalState.approval}
              scheduledLabel={
                broadcast.scheduledAt ? formatApprovalDateTime(broadcast.scheduledAt) : null
              }
              approverName={approvalApproverName}
              requesterName={approvalRequesterName}
              viewer={approvalState.viewer}
              onCancel={handleApprovalCancel}
              onRemind={handleApprovalRemind}
              busy={approvalBusy}
              message={approvalMessage}
            />
          ) : null}
          {approvalState ? (
            <ApproverSection
              approval={approvalState.approval}
              viewer={approvalState.viewer}
              requesterName={approvalRequesterName}
              recipientCount={approvalState.gate.recipientCount}
              scheduledLabel={
                broadcast.scheduledAt ? formatApprovalDateTime(broadcast.scheduledAt) : null
              }
              messageSummary={approvalMessageSummary}
              messageHref="#broadcast-content"
              onApprove={handleApprovalApprove}
              onReject={handleApprovalReject}
              busy={approvalBusy}
              message={approvalMessage}
            />
          ) : null}
          {canReRequest && approvalState ? (
            <section aria-label="承認の依頼" className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink text-sm font-semibold">承認を依頼する</p>
              <p className="text-ink-secondary mt-1 text-xs leading-5">
                {approvalState.gate.recipientCount.toLocaleString('ja-JP')}人への配信です。
                承認されるまで送られません。
              </p>
              <div className="mt-3">
                <ApprovalRequestFields
                  recipientCount={approvalState.gate.recipientCount}
                  threshold={approvalState.gate.threshold}
                  candidates={approvalCandidates}
                  candidatesState={approvalCandidates.length > 0 ? 'ready' : 'loading'}
                  approverId={reApproverId}
                  onApproverChange={setReApproverId}
                  note={reApprovalNote}
                  onNoteChange={setReApprovalNote}
                />
              </div>
              {approvalMessage ? <p className="text-danger mt-2 text-xs">{approvalMessage}</p> : null}
              <div className="mt-3">
                <Button variant="secondary" onClick={handleApprovalRequest} disabled={approvalBusy}>
                  承認を依頼する
                </Button>
              </div>
            </section>
          ) : null}
          {/* ★V7: 予約・下書きも共通の枠の幅いっぱいに広げる。絞ると 1920px で右が大きく空く。 */}
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">送信の進み具合</p>
            {/*
              Progress（処理の進み部品）は送信中（sending）だけに出す。
              下書き・予約で preparing の棒や回る印を出すと、まだ送って
              いないのに送り始めているように見える。そのときは棒も印も
              出さず、1行の文だけにする。sent は上の分かれ道で SentResult
              へ行くので、ここに done / partial の分岐は置かない。
            */}
            {broadcast.status === 'sending' ? (
              <>
                <Progress
                  state="active"
                  title="送信中"
                  percent={total > 0 ? (success / total) * 100 : 0}
                  countText={`${success.toLocaleString('ja-JP')} / ${total.toLocaleString('ja-JP')} 件`}
                  className="mt-3"
                />
                {/*
                  失敗数は `totalCount - successCount` でしか出せない。送信中は
                  「まだ送っていないぶん」も同じ引き算に入るため、その数を失敗として
                  出すと、起きていない失敗を作ることになる。完了してから出す。
                  （下の「到達」の欄と同じ理由。）
                */}
                {/* 開始・完了の時刻を別々に持っていない。sent_at は完了だけ。 */}
                <p className="text-ink-faint mt-2 text-xs">
                  {broadcast.sentAt
                    ? `完了 ${formatBroadcastDateTime(broadcast.sentAt)}`
                    : '開始・完了の時刻は記録していません'}
                </p>
              </>
            ) : (
              <p className="text-ink-secondary mt-2 text-sm">
                {broadcast.scheduledAt
                  ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に送り始めます`
                  : 'まだ送っていません'}
              </p>
            )}
          </section>

          <div data-design="KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* 送信の欄は「これから」と「終わったこと」を書き分ける。
                予約しただけの配信に「予約どおり実行」と書くと、まだ起きて
                いないことを済んだことにしてしまう。 */}
            <Stat
              label="送信"
              value={total}
              unit="件"
              detail={
                broadcast.status === 'sent'
                  ? broadcast.scheduledAt
                    ? '予約どおり実行'
                    : '即時配信'
                  : broadcast.status === 'sending'
                    ? '送信中'
                    : broadcast.scheduledAt
                      ? '予約した時刻に実行します'
                      : 'まだ送っていません'
              }
            />
            {/*
              失敗数は `totalCount - successCount` でしか出せない。送信中は
              「まだ送っていないぶん」も同じ引き算に入るため、その数を失敗として
              出すと、起きていない失敗を作ることになる。完了してから出す。
            */}
            <Stat
              label="到達"
              value={success}
              unit="件"
              detail={
                broadcast.status === 'sent'
                  ? `${pct(success, total)} ・ 失敗 ${failed.toLocaleString('ja-JP')}件`
                  : broadcast.status === 'sending'
                    ? '送信中のため、失敗の数は終わってから確定します'
                    : '送信前のため、到達はまだありません'
              }
            />
            <Stat
              label="開封"
              value={insightState === 'ready' ? insight?.uniqueImpression ?? null : null}
              unit="件"
              detail={
                insightState === 'loading'
                  ? '読み込んでいます'
                  : insightState === 'error'
                    ? '読み込めませんでした'
                    : openInsightDetail(insight)
              }
            />
            <Stat
              label="クリック"
              value={insightState === 'ready' ? insight?.uniqueClick ?? null : null}
              unit="件"
              detail={
                insightState === 'loading'
                  ? '読み込んでいます'
                  : insightState === 'error'
                    ? '読み込めませんでした'
                    : clickInsightDetail(insight)
              }
            />
          </div>

          {insightState === 'error' ? (
            <div className="bg-canvas rounded-card border-hairline flex flex-wrap items-center justify-between gap-3 border p-4">
              <p className="text-ink-faint text-xs leading-relaxed">
                開封・クリックを読み込めませんでした。送信の件数は上のとおりです。
              </p>
              <Button onClick={() => setReloadToken((value) => value + 1)}>集計を再読み込み</Button>
            </div>
          ) : null}

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">アカウント別の内訳</p>
            {/* 複数アカウントに配ったとき、どのアカウントで何件届いたかを
                残していない。totalCount / successCount は全体の合計だけ。 */}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              アカウントごとの送信・到達・開封は記録していません。複数アカウントに配った場合も、上の数は合計です。
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-semibold">この配信の設定</p>
              <Link
                href={`/broadcasts/new?duplicateFrom=${encodeURIComponent(broadcast.id)}`}
                className="border-hairline text-action rounded-control border px-3 py-1 text-xs hover:underline"
              >
                同じ設定で作り直す
              </Link>
            </div>
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              複製して作る操作です。題名と本文を引き継いで新規作成を開きます。宛先・予約日時は引き継がないので、送る前に確かめてください。
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              {/* BROADCAST-15: 一覧・作成確認と同じ要約（audienceSummary）を出す。
                  シナリオ指定を「絞り込みあり」「タグ未指定」とは出さない。 */}
              <Row label="宛先の条件" value={audienceLabel} />
              <Row
                label="対象人数"
                value={`${total.toLocaleString('ja-JP')}人（ブロック中を自動で除外）`}
              />
              <Row label="メッセージ" value={`1通（${messageTypeLabel(broadcast.messageType)}）`} />
              <Row
                label="送信タイミング"
                value={
                  broadcast.scheduledAt
                    ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に予約`
                    : '即時配信'
                }
              />
              {/* 誰が作ったかを記録していない。 */}
              <Row
                label="作成者"
                value={broadcast.createdAt
                  ? `記録していません ・ ${formatBroadcastDateTime(broadcast.createdAt)} 作成`
                  : '記録していません ・ 作成日時 —'}
              />
            </dl>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-semibold">クリックされたリンク</p>
              <Link href="/inflow-links" className="text-action text-xs hover:underline">
                流入経路で見る
              </Link>
            </div>
            {/* どのリンクがどの配信に入っていたかを結ぶ記録が無い（18-29）。 */}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              配信ごとのリンク別クリックはまだ出せません。リンク全体のクリックは「分析 → URLクリック」で見られます。
            </p>
          </section>

          <section
            ref={contentRef}
            id="broadcast-content"
            className="bg-canvas rounded-card border-hairline scroll-mt-20 border p-5"
          >
            <p className="text-ink text-sm font-semibold">送った内容</p>
            <p className="text-ink-faint mt-0.5 text-xs">実際に届いた形</p>
            <p className="text-ink-faint mb-2 mt-1 text-xs">実際のLINE表示に近い確認用プレビューです。</p>
            <div className="bg-canvas-sunken rounded-card p-3">
              <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                {broadcast.messageContent}
              </p>
            </div>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">数え方</p>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>
                ・開封は LINE の集計値です。個人単位では取れないため「誰が読んだか」は分かりません
              </li>
              <li>・配信対象が20人未満のときは、LINE側の仕様で開封数・クリック数が表示されません</li>
              {/* 上のクリックは LINE の集計値（`broadcast_insights.unique_click`）。
                  短縮URLの実測は別の数で、この欄には出していない。 */}
              <li>
                ・クリックも LINE の集計値で、母数は開封ではなく到達です。短縮URL（/t/…）の実測とは数字がずれることがあります
              </li>
            </ul>
          </section>

          <Link
            href="/broadcasts"
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken inline-block border px-4 py-2 text-sm font-medium"
          >
            一覧へ戻る
          </Link>
        </div>
      )}
      {/*
        ★V7 `x63W5x`：読み込み中は押せないボタンだけのバーを出さない。
        配信が読めてから出す。
      */}
      {broadcast ? (
        <StickyBar
          className="mt-6"
          actions={<Button onClick={exportCsv}>CSVで書き出す</Button>}
        />
      ) : null}
    </div>
  )
}

function rateText(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${((rate <= 1 ? rate * 100 : rate)).toFixed(1)}%`
}

function SentResult({
  broadcast,
  insight,
  insightState,
  contentRef,
}: {
  broadcast: ApiBroadcast
  insight: (BroadcastInsight & { suppressedByAudienceSize: boolean }) | null
  insightState: 'loading' | 'ready' | 'error'
  contentRef: { current: HTMLElement | null }
}) {
  const delivered = insight?.delivered ?? broadcast.successCount
  const opened = insight?.opens?.count ?? insight?.uniqueImpression ?? null
  const openRate = insight?.opens?.rate ?? insight?.openRate ?? null
  const failed = Math.max(0, broadcast.totalCount - broadcast.successCount)

  return (
    <div className="space-y-4">
      <nav aria-label="配信内容を見る" className="bg-canvas-sunken rounded-card grid grid-cols-5 p-1 text-center text-sm font-semibold">
        {['概要', 'クリック', '友だち', 'エラー', '配信内容'].map((label, index) => (
          <span key={label} className={index === 0 ? 'bg-canvas text-accent-deep rounded-control px-3 py-2' : 'text-ink-secondary px-3 py-2'}>{label}</span>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">配信結果</h2>
            <p className="text-ink-faint mt-1 text-xs">送信・開封・クリック・ブロックを確認します。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="border-hairline rounded-control border p-3">
                <p className="text-ink-faint text-xs font-semibold">送信成功</p>
                <p className="text-ink mt-2 text-sm font-bold">{broadcast.totalCount > 0 ? rateText(delivered / broadcast.totalCount) : '—'}</p>
                <p className="text-ink mt-1 text-lg font-bold">{delivered.toLocaleString('ja-JP')}人</p>
                <p className="text-ink-faint text-xs">届いた人</p>
              </div>
              <div className="border-hairline rounded-control border p-3">
                <p className="text-ink-faint text-xs font-semibold">開封</p>
                <p className="text-ink mt-2 text-sm font-bold">{insightState === 'loading' ? '読込中' : rateText(openRate)}</p>
                <p className="text-ink mt-1 text-lg font-bold">{opened == null ? '—' : `${opened.toLocaleString('ja-JP')}人`}</p>
                <p className="text-ink-faint text-xs">開いた人</p>
              </div>
            </div>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">反応</h2>
            <p className="text-ink-faint mt-1 text-xs">ボタンとリンクごとの結果です。</p>
            {insight?.links?.length ? (
              <div className="mt-3 space-y-2">
                {insight.links.map((link) => (
                  <div key={link.id} className="bg-canvas-sunken rounded-control flex items-center justify-between gap-4 p-3">
                    <div className="min-w-0"><p className="text-ink truncate text-sm font-bold" title={link.label}>{link.label}</p><p className="text-ink-faint truncate text-xs" title={link.url}>{link.url}</p></div>
                    <p className="text-ink-secondary shrink-0 text-xs">クリック {link.uniqueClickCount.toLocaleString('ja-JP')}人（{rateText(link.clickRate)}）</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ink-faint bg-canvas-sunken mt-3 rounded-control p-3 text-xs">計測したボタン・リンクはありません。</p>
            )}
            <div className="bg-canvas-sunken mt-3 rounded-control p-3">
              <p className="text-ink text-sm font-bold">エラー</p>
              <p className="text-ink-faint mt-1 text-xs">送信失敗 {failed.toLocaleString('ja-JP')}人</p>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">配信した設定</h2>
            <p className="text-ink-faint mt-1 text-xs">この配信で使った対象と送信方法です。</p>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="配信済み" value={`${delivered.toLocaleString('ja-JP')}人`} />
              <Row label="開封率" value={rateText(openRate)} />
              <Row label="クリック率" value={rateText(insight?.clickRate)} />
            </dl>
          </section>

          <section ref={contentRef} id="broadcast-content" className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">メッセージプレビュー</h2>
            <p className="text-ink-faint mt-1 text-xs">実際のLINE表示に近い確認用プレビューです。</p>
            <div className="bg-info mt-3 min-h-48 rounded-card p-4">
              <p className="text-ink bg-canvas rounded-control px-4 py-3 text-sm leading-6 whitespace-pre-wrap">{broadcast.messageContent}</p>
              {broadcast.messageOptions?.buttons?.map((button) => (
                <p key={`${button.label}-${button.value}`} className="text-action bg-canvas mt-2 truncate rounded-control px-3 py-2 text-center text-xs font-bold" title={button.value}>{button.label}</p>
              ))}
            </div>
          </section>
        </div>
      </div>

      {insightState === 'error' && <p role="alert" className="text-danger text-xs">開封・クリックを読み込めませんでした。</p>}
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  detail,
}: {
  label: string
  value: number | null
  unit: string
  detail: string
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint text-xs">{label}</p>
      <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
        {value == null ? '—' : value.toLocaleString('ja-JP')}
        <span className="text-ink-faint ml-0.5 text-xs font-normal">{unit}</span>
      </p>
      <p className="text-ink-faint mt-0.5 text-xs">{detail}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-faint shrink-0">{label}</dt>
      <dd className="text-ink-secondary min-w-0 text-right">{value}</dd>
    </div>
  )
}

export default function BroadcastDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <BroadcastDetailInner />
    </Suspense>
  )
}
