'use client'

/*
 * ★V8 シナリオ配信の配信結果（Pencil `X4STXS`）。
 *
 * 型（DetailPage）に、戻る・題・説明・右上の操作（シナリオの編集へ・CSVで書き出す）と、
 * 中身（数の帯・通ごとの反応・参加中の友だちの表）を渡す。
 * 取得口・操作（止める・再開・失敗を再送・別のシナリオへ移す・予定を見る・CSV）は
 * 今までの V8（app/scenarios/results/results-v8.tsx）と v7（results/page.tsx）から写した。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Download, Eye, MoreHorizontal, PencilLine } from 'lucide-react'
import type { Scenario, ScenarioStats, ScenarioStep } from '@line-crm/shared'
import { api, ApiError, type ScenarioRuns } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { DetailPage } from '@/components/templates'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import NoteBar from '@/components/shared/note-bar'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import { FriendPlanDialog } from '@/components/scenarios/scenario-dialogs'
import { formatDateTime, formatNumber } from '@/lib/format'
import styles from './results.module.css'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }
type Subscription = ScenarioRuns['subscriptions'][number]

/** 購読一覧の1ページぶん。サーバーの上限は100、画面の既定は50。 */
const RUNS_PAGE_SIZE = 50

/** 割合。分母が 0（まだ誰も参加していない）ときは「0.0%」にせず「—」（測れていないのと分ける）。 */
function percentLabel(value: number, total: number): string {
  if (total === 0) return '—'
  return `${((value / total) * 100).toFixed(1)}%`
}

function scheduleLabel(step: ScenarioStep): string {
  if (step.deliveryTime) return step.offsetDays ? `${step.offsetDays}日後 ${step.deliveryTime}` : `登録当日 ${step.deliveryTime}`
  const minutes = step.offsetMinutes ?? step.delayMinutes ?? 0
  const days = (step.offsetDays ?? 0) + Math.floor(minutes / 1_440)
  const rest = minutes % 1_440
  const hours = Math.floor(rest / 60)
  const mins = rest % 60
  const parts = [days ? `${days}日` : '', hours ? `${hours}時間` : '', mins ? `${mins}分` : ''].filter(Boolean)
  return parts.length ? `${parts.join('')}後` : '登録直後'
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

/** 購読の状態の札（絵：途中・送信中・止まっている・送れずに止まった・読み終えた）。 */
function subscriptionState(sub: Subscription): { label: string; tone: StatusBadgeTone } {
  if (sub.status === 'completed') return { label: '読み終えた', tone: 'info' }
  if (sub.status === 'delivering') return { label: '送信中', tone: 'success' }
  if (sub.status === 'paused') {
    return sub.pauseReason === 'delivery_failed'
      ? { label: '送れずに止まった', tone: 'warning' }
      : { label: '止まっている', tone: 'neutral' }
  }
  return { label: '途中', tone: 'success' }
}

function nextLabel(sub: Subscription): string {
  if (sub.status === 'completed') return '—'
  if (sub.status === 'paused') return '—（止めている）'
  return sub.nextDeliveryAt ? formatDateTime(sub.nextDeliveryAt) : '—'
}

export default function ScenarioResultsV8() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const role = useStaffRole()
  // 役割が読めるまでは出す（最後の守りはサーバー）。閲覧のみは購読を変える操作（…）を隠す。
  const canEdit = role === null || canManageRole(role)
  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [stats, setStats] = useState<ScenarioStats | null>(null)
  /*
   * 配信記録（runs）はシナリオ本体・集計とは別の流れで読む（SCENARIO-13）。
   * 取得失敗は「0件」と分けて、読み直し口を出す（SCENARIO-10）。
   */
  const [runs, setRuns] = useState<ScenarioRuns | null>(null)
  const [runsState, setRunsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('loading')
  const [runsLoadingMore, setRunsLoadingMore] = useState(false)
  const [runsMoreError, setRunsMoreError] = useState('')
  /* 状態の絞り込みはサーバー側で全件へ掛ける（SCENARIO-12）。 */
  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resultsMissing, setResultsMissing] = useState(false)
  /* 友だち単位の操作（N-054）。busy は「購読ID:操作」で持ち、押した行だけを止める。 */
  const [opBusy, setOpBusy] = useState<string | null>(null)
  const [opError, setOpError] = useState('')
  const [moveTarget, setMoveTarget] = useState<{ subscriptionId: string; friendName: string } | null>(null)
  const [moveScenarioId, setMoveScenarioId] = useState('')
  const [moveOptions, setMoveOptions] = useState<Scenario[] | null>(null)
  const [moveOptionsError, setMoveOptionsError] = useState(false)
  /* IDEA-05: 選んだ友だちへの配信予定を送信なしで確かめる窓。 */
  const [planOpen, setPlanOpen] = useState(false)
  const [planFriend, setPlanFriend] = useState<{ id: string; name: string } | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const opKeys = useRef(new IdempotencyKeyStore())

  usePageTitle(scenario ? `配信結果：${scenario.name}` : null)
  usePageCrumbs([{ label: 'シナリオ配信', href: '/scenarios' }])

  /* 画面（id）やアカウントを切り替えたあとに返ってきた古い応答を捨てる世代番号（SCENARIO-11）。 */
  const loadSeqRef = useRef(0)

  /** シナリオ本体と集計。ここだけ先に読めれば本文は見せられる。 */
  const loadMain = useCallback(async (seq: number) => {
    if (!id) {
      setLoading(false)
      setError('')
      setResultsMissing(false)
      return
    }
    setLoading(true)
    setError('')
    setResultsMissing(false)
    try {
      const [scenarioResponse, statsResponse] = await Promise.all([
        scenarioReferenceData.scenario(id),
        scenarioReferenceData.stats(id),
      ])
      if (seq !== loadSeqRef.current) return
      if (!scenarioResponse.success || !statsResponse.success) throw new Error('load failed')
      setScenario(scenarioResponse.data)
      setStats(statsResponse.data)
    } catch (caught) {
      if (seq !== loadSeqRef.current) return
      if (caught instanceof ApiError && caught.status === 404) {
        setResultsMissing(true)
      } else {
        setError('配信結果を読み込めませんでした。時間を置いてもう一度お試しください。')
      }
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [id])

  /*
   * 購読一覧は50件ずつカーソルで辿る（SCENARIO-12）。続きのページは購読の行だけを
   * 後ろへ足し、集計・通別結果は新しい応答のものへ置き換える。
   */
  const loadRuns = useCallback(async (seq: number, cursor?: string) => {
    if (!id) return
    if (!selectedAccountId) {
      // アカウントが選ばれていないと購読は読めない。「0件」ではなく未取得。
      if (seq === loadSeqRef.current) {
        setRuns(null)
        setRunsState('idle')
      }
      return
    }
    if (cursor) {
      setRunsLoadingMore(true)
      setRunsMoreError('')
    } else {
      setRuns(null)
      setRunsState('loading')
      setRunsMoreError('')
    }
    try {
      const res = await api.scenarios.runs(id, selectedAccountId, {
        limit: RUNS_PAGE_SIZE,
        status: subscriptionStatus || undefined,
        cursor,
      })
      if (seq !== loadSeqRef.current) return
      if (!res.success) throw new Error(res.error)
      setRuns((current) => {
        if (!cursor || !current) return res.data
        const seen = new Set(current.subscriptions.map((s) => s.id))
        return {
          ...res.data,
          subscriptions: [
            ...current.subscriptions,
            ...res.data.subscriptions.filter((s) => !seen.has(s.id)),
          ],
        }
      })
      setRunsState('ready')
    } catch {
      if (seq !== loadSeqRef.current) return
      if (cursor) {
        setRunsMoreError('続きを読み込めませんでした。もう一度お試しください。')
      } else {
        setRunsState('error')
      }
    } finally {
      if (seq === loadSeqRef.current) setRunsLoadingMore(false)
    }
  }, [id, selectedAccountId, subscriptionStatus])

  /** 操作後の再集計。失敗しても古い値を0に置き換えない。 */
  const refreshStats = useCallback(async (seq: number) => {
    try {
      const res = await scenarioReferenceData.stats(id, true)
      if (seq === loadSeqRef.current && res.success) setStats(res.data)
    } catch {
      /* 集計の取り直しに失敗しても、表示済みの値は残す */
    }
  }, [id])

  useEffect(() => {
    if (accountLoading) return
    const seq = ++loadSeqRef.current
    setScenario(null)
    setStats(null)
    setRuns(null)
    setRunsMoreError('')
    setOpError('')
    setMoveTarget(null)
    setMoveOptions(null)
    setMoveOptionsError(false)
    void loadMain(seq)
    void loadRuns(seq)
  }, [accountLoading, loadMain, loadRuns])

  /** 購読一覧だけを読み直す。再試行と操作後の更新はこの領域に限る（SCENARIO-13）。 */
  const reloadRuns = useCallback(() => {
    const seq = loadSeqRef.current
    void loadRuns(seq)
    void refreshStats(seq)
  }, [loadRuns, refreshStats])

  const loadMoreRuns = () => {
    const cursor = runs?.pagination.nextCursor
    if (!cursor || runsLoadingMore) return
    void loadRuns(loadSeqRef.current, cursor)
  }

  const sortedSteps = useMemo(
    () => [...(scenario?.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder),
    [scenario],
  )
  const statsByOrder = useMemo(
    () => new Map((stats?.steps ?? []).map((step) => [step.stepOrder, step])),
    [stats],
  )
  const runsByOrder = useMemo(
    () => new Map((runs?.steps ?? []).map((step) => [step.stepOrder, step])),
    [runs],
  )

  const exportCsv = () => {
    if (!scenario || !stats) return
    /* 到達率の分母は集計（stats）の参加人数で統一する（#495 軽19）。 */
    const rows = [
      ['ステップ', '配信時期', '到達人数', '到達率', '開封率', 'クリック率'],
      ...sortedSteps.map((step) => {
        const result = statsByOrder.get(step.stepOrder)
        return [
          `${step.stepOrder}通目`, scheduleLabel(step), result?.reachedCount ?? '—',
          result ? percentLabel(result.reachedCount, stats.enrolledTotal) : '—', '—', '—',
        ]
      }),
    ]
    const csv = `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `scenario-results-${id}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  /** 購読1行への操作。成功したら runs を読み直して行の表示を新しい状態へ揃える。 */
  const runSubscriptionOp = async (
    subscription: { id: string; friendName: string },
    op: 'pause' | 'resume' | 'retry',
  ) => {
    const signature = `${subscription.id}:${op}`
    const key = opKeys.current.get(signature)
    setOpBusy(signature)
    setOpError('')
    try {
      const res = await api.scenarios.subscriptionOps[op](subscription.id, key)
      if (!res.success) {
        setOpError(`${subscription.friendName} への操作を完了できませんでした。${res.error}`)
        return
      }
      opKeys.current.clear(signature)
      reloadRuns()
    } catch {
      setOpError(`${subscription.friendName} への操作を完了できませんでした。時間を置いてもう一度お試しください。`)
    } finally {
      setOpBusy(null)
    }
  }

  /** 移し先候補を取る。失敗は0件と分けて、窓の中で読み直せるようにする。 */
  const loadMoveOptions = async () => {
    setMoveOptions(null)
    setMoveOptionsError(false)
    const res = await api.scenarios.list({ accountId: selectedAccountId || undefined }).catch(() => null)
    if (res?.success) {
      setMoveOptions(res.data)
    } else {
      setMoveOptionsError(true)
    }
  }

  const openMoveDialog = async (subscription: { id: string; friendName: string }) => {
    setMoveTarget({ subscriptionId: subscription.id, friendName: subscription.friendName })
    setMoveScenarioId('')
    setOpError('')
    if (moveOptions === null) await loadMoveOptions()
  }

  const confirmMove = async () => {
    if (!moveTarget || !moveScenarioId) return
    const signature = `${moveTarget.subscriptionId}:move:${moveScenarioId}`
    const key = opKeys.current.get(signature)
    setOpBusy(signature)
    setOpError('')
    try {
      const res = await api.scenarios.subscriptionOps.move(moveTarget.subscriptionId, moveScenarioId, key)
      if (!res.success) {
        setOpError(res.error)
        return
      }
      opKeys.current.clear(signature)
      setMoveTarget(null)
      reloadRuns()
    } catch {
      setOpError('移し替えを完了できませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setOpBusy(null)
    }
  }

  const closeMove = () => {
    if (opBusy) return
    setMoveTarget(null)
    setOpError('')
  }

  const moveChoices = (moveOptions ?? []).filter((item) => item.id !== id && item.isActive)

  /* 対象が無いときは右上の操作も出さない。戻り先は TargetMissing のボタンが持つ。 */
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="配信結果を見るシナリオが指定されていません"
        description="一覧から、結果を見たいシナリオを選び直してください。"
        backHref="/scenarios"
        backLabel="シナリオ一覧へ戻る"
      />
    )
  }

  if (!loading && (resultsMissing || (!error && !scenario))) {
    return (
      <TargetMissing
        kind="not-found"
        title="このシナリオは見つかりません"
        description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。"
        backHref="/scenarios"
        backLabel="シナリオ一覧へ戻る"
      />
    )
  }

  if (!loading && error) {
    return (
      <TargetMissing
        kind="error"
        title="配信結果を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void loadMain(loadSeqRef.current)}
      />
    )
  }

  /*
   * 数の帯：始まった（参加した人）・読み終えた（全部届いた人）・途中（いま途中・止まっている人）・
   * 離れた（終わらずに抜けた人＝参加 − 読み終えた − 途中）。
   */
  const enrolled = stats?.enrolledTotal ?? null
  const completedCount = runs?.summary.completed ?? stats?.completed ?? null
  const inProgress = runs
    ? runs.summary.active + runs.summary.delivering + runs.summary.paused
    : stats ? stats.activeNow + stats.paused : null
  const leftCount = enrolled !== null && completedCount !== null && inProgress !== null
    ? Math.max(0, enrolled - completedCount - inProgress)
    : null
  /* 届いた人数が次の通で最も減った通（「ここで離れた」）。離れた人がいるときだけ示す。 */
  const reachedOf = (step: ScenarioStep) => runsByOrder.get(step.stepOrder)?.delivered ?? statsByOrder.get(step.stepOrder)?.reachedCount ?? null
  let dropStep: { order: number; count: number; base: number } | null = null
  if (leftCount) {
    sortedSteps.forEach((step, index) => {
      const next = sortedSteps[index + 1]
      if (!next) return
      const here = reachedOf(step)
      const there = reachedOf(next)
      if (here === null || there === null) return
      const count = Math.min(leftCount, here - there)
      if (count > 0 && (!dropStep || count > dropStep.count)) dropStep = { order: step.stepOrder, count, base: here }
    })
  }
  const drop = dropStep as { order: number; count: number; base: number } | null
  /* 送れずに止まった人（実行記録の失敗数）。取れないときは数を断定しない。 */
  const failedTotal = (runs?.steps ?? []).reduce(
    (acc, step) => acc + (step.failed.state === 'available' ? (step.failed.value ?? 0) : 0),
    0,
  )
  const deliveringCount = runs?.summary.delivering ?? 0

  return (
    <DetailPage
      boardId="X4STXS"
      identity={<Link href="/scenarios" className={styles.backLink}>← シナリオ配信へ</Link>}
      title={scenario ? `配信結果：${scenario.name}` : '配信結果'}
      description="始まった・読み終えた・どの通まで届いたかを見ます。"
      actions={(
        <span className={styles.headActions}>
          <Button href={`/scenarios/detail?id=${encodeURIComponent(id)}`}>
            <PencilLine size={15} aria-hidden="true" />シナリオの編集へ
          </Button>
          {/* 書き出しは主ボタンにしない。この画面の本筋は結果を見ること（横断レビュー §7）。 */}
          <Button onClick={exportCsv} disabled={!scenario || !stats}>
            <Download size={15} aria-hidden="true" />CSVで書き出す
          </Button>
        </span>
      )}
    >
      {loading ? <ListState kind="loading" title="配信結果を読み込んでいます" /> : null}

      {!loading && scenario && stats ? (
        <>
          <div className={styles.kpiBox}>
          <KpiBand data-design="KPIs">
            <KpiCard icon={null} title="始まった" value={enrolled} unit="人" detail="購読を始めた人" />
            <KpiCard
              presentation="cell"
              icon={null}
              title="読み終えた"
              value={completedCount}
              unit="人"
              detail={enrolled && completedCount !== null ? percentLabel(completedCount, enrolled) : '—'}
            />
            <KpiCard icon={null} title="途中" value={inProgress} unit="人" detail="いま途中にいる人" />
            <KpiCard
              presentation="cell"
              icon={null}
              title="離れた"
              value={leftCount}
              unit="人"
              detail={drop ? `${drop.order}通目で多い` : '終わらずに抜けた人'}
            />
          </KpiBand>
          </div>

          <section className={styles.section} aria-labelledby="scenario-results-steps">
            <div className={styles.sectionHead}>
              <h2 id="scenario-results-steps" className={styles.sectionTitle}>通ごとの反応</h2>
              {deliveringCount > 0 ? (
                <span className={styles.sectionNote} role="status">いま送っています（送信中 {formatNumber(deliveringCount)}人）</span>
              ) : null}
            </div>
            <NoteBar tone="info">
              LINE では通ごとの開いた数を取れません。取れない数は「—」で出します。押した数は人数（同じ人は1人）。
            </NoteBar>
            {sortedSteps.length === 0 ? (
              <ListState kind="empty" title="配信内容がまだありません" description="シナリオ編集からメッセージを追加してください。" />
            ) : (
              <ol className={styles.stepList}>
                {sortedSteps.map((step) => {
                  const run = runsByOrder.get(step.stepOrder)
                  const reached = reachedOf(step)
                  const pct = reached !== null && stats.enrolledTotal > 0
                    ? Math.min(100, (reached / stats.enrolledTotal) * 100)
                    : 0
                  const opened = run?.opened.state === 'available' && run.opened.value !== null ? `${formatNumber(run.opened.value)}人` : '—'
                  const clicked = run?.clicked.state === 'available' && run.clicked.value !== null ? `${formatNumber(run.clicked.value)}人` : '—'
                  return (
                    <li key={step.id} className={styles.stepRow}>
                      <div className={styles.stepTop}>
                        <span className={styles.stepNo}>{step.stepOrder}通目</span>
                        <span className={styles.stepWhen}>{scheduleLabel(step)}</span>
                        <span className={styles.stepReach}>{reached === null ? '—' : `${formatNumber(reached)}人に届いた`}</span>
                        <span className={styles.stepMeta}>
                          {`届いた率 ${reached === null ? '—' : percentLabel(reached, stats.enrolledTotal)}・開いた ${opened}・押した ${clicked}`}
                        </span>
                        {drop && drop.order === step.stepOrder ? (
                          <span className={styles.stepDrop}>{`ここで ${formatNumber(drop.count)}人（${Math.round((drop.count / drop.base) * 100)}%）離れた`}</span>
                        ) : null}
                      </div>
                      <progress className={styles.stepBar} max={100} value={pct} aria-label={`${step.stepOrder}通目の届いた率`} />
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {/*
            参加中の友だち。止める・再開・失敗を再送・別のシナリオへ移すは行の「…」の中
            （止まり方 pauseReason で「再開」と「失敗を再送」を出し分ける）。
          */}
          <section className={styles.section} aria-labelledby="scenario-results-friends">
            <div className={styles.sectionHead}>
              <h2 id="scenario-results-friends" className={styles.sectionTitle}>参加中の友だち</h2>
              {failedTotal > 0 ? (
                <button type="button" className={styles.sectionLink} onClick={() => setSubscriptionStatus('paused')}>
                  {`送れずに止まった人が ${formatNumber(failedTotal)}人・止まっている人だけを見る`}
                </button>
              ) : null}
            </div>
            {opError && !moveTarget ? <NoteBar tone="warn">{opError}</NoteBar> : null}
            <div className={styles.tools}>
              {/* 状態の絞り込みはサーバーへ渡して全件へ掛ける（SCENARIO-12）。 */}
              <span className={styles.statusSelect}>
                <Select
                  value={subscriptionStatus}
                  onChange={(value) => setSubscriptionStatus(value)}
                  aria-label="購読の状態で絞り込む"
                  options={[
                    { value: '', label: '購読の状態：すべて' },
                    { value: 'active', label: '購読の状態：途中' },
                    { value: 'delivering', label: '購読の状態：送信中' },
                    { value: 'paused', label: '購読の状態：止まっている' },
                    { value: 'completed', label: '購読の状態：読み終えた' },
                  ]}
                />
              </span>
              {runs ? (
                <span className={styles.count}>{`${formatNumber(runs.subscriptions.length)} / ${formatNumber(runs.pagination.total)}人`}</span>
              ) : null}
              <span className={styles.toolsSpacer} />
              <Button
                type="button"
                onClick={() => {
                  setPlanFriend(null)
                  setPlanOpen(true)
                }}
              >
                <Eye size={15} aria-hidden="true" />友だちを選んで配信予定を見る
              </Button>
            </div>
            {runsState === 'idle' ? (
              <p className={styles.idle}>上部のLINEアカウントを選ぶと、購読している友だちの一覧を表示します。</p>
            ) : runsState === 'loading' ? (
              <ListState kind="loading" title="購読一覧を読み込んでいます" />
            ) : runsState === 'error' ? (
              <ListState
                kind="error"
                title="購読一覧を表示できませんでした"
                description="登録が消えたわけではありません。もう一度読み込んでください。"
                onRetry={() => void loadRuns(loadSeqRef.current)}
              />
            ) : !runs || runs.subscriptions.length === 0 ? (
              <ListState
                kind="empty"
                title="購読している友だちはまだいません"
                description="開始条件に一致した友だちがここに並びます。"
              />
            ) : (
              <>
                <div className={styles.table} role="table" aria-label="参加中の友だち">
                  <div className={styles.headRow} role="row">
                    <span className={styles.colName} role="columnheader">友だち</span>
                    <span className={styles.colState} role="columnheader">状態</span>
                    <span className={styles.colNow} role="columnheader">いま</span>
                    <span className={styles.colNext} role="columnheader">次に届く</span>
                    <span className={styles.colPlan} role="columnheader"><span className="sr-only">予定</span></span>
                    <span className={styles.colMenu} role="columnheader"><span className="sr-only">操作</span></span>
                  </div>
                  {runs.subscriptions.map((sub) => {
                    const state = subscriptionState(sub)
                    const pausedByFailure = sub.status === 'paused' && sub.pauseReason === 'delivery_failed'
                    const items: ActionMenuItem[] = []
                    if (sub.status === 'active') {
                      items.push({
                        id: 'pause',
                        label: opBusy === `${sub.id}:pause` ? '止めています…' : '止める',
                        disabled: opBusy !== null,
                        onSelect: () => void runSubscriptionOp(sub, 'pause'),
                      })
                    }
                    if (sub.status === 'paused') {
                      items.push({
                        id: 'resume',
                        label: opBusy === `${sub.id}:resume` ? '再開しています…' : '再開する',
                        disabled: opBusy !== null,
                        onSelect: () => void runSubscriptionOp(sub, 'resume'),
                      })
                      if (pausedByFailure) {
                        items.push({
                          id: 'retry',
                          label: opBusy === `${sub.id}:retry` ? '再送しています…' : '失敗を再送',
                          disabled: opBusy !== null,
                          onSelect: () => void runSubscriptionOp(sub, 'retry'),
                        })
                      }
                    }
                    items.push({
                      id: 'move',
                      label: '別のシナリオへ移す',
                      disabled: opBusy !== null,
                      onSelect: () => void openMoveDialog(sub),
                    })
                    const showMenu = canEdit && (sub.status === 'active' || sub.status === 'paused')
                    return (
                      <div key={sub.id} className={styles.row} role="row">
                        <span className={styles.colName} role="cell" title={sub.friendName}>{sub.friendName}</span>
                        <span className={styles.colState} role="cell">
                          <StatusBadge tone={state.tone} size="compact">{state.label}</StatusBadge>
                        </span>
                        <span className={styles.colNow} role="cell">{`${sub.currentStepOrder}通目まで`}</span>
                        <span className={styles.colNext} role="cell">{nextLabel(sub)}</span>
                        <span className={styles.colPlan} role="cell">
                          <Button
                            onClick={() => {
                              setPlanFriend({ id: sub.friendId, name: sub.friendName })
                              setPlanOpen(true)
                            }}
                          >
                            <Eye size={15} aria-hidden="true" />予定を見る
                          </Button>
                        </span>
                        <span className={styles.colMenu} role="cell">
                          {showMenu ? (
                            <span className={styles.menuBox}>
                              <IconButton
                                aria-label={`${sub.friendName}のその他の操作`}
                                aria-expanded={openMenuId === sub.id}
                                onClick={() => setOpenMenuId((current) => (current === sub.id ? null : sub.id))}
                              >
                                <MoreHorizontal aria-hidden="true" />
                              </IconButton>
                              <ActionMenu
                                open={openMenuId === sub.id}
                                ariaLabel={`${sub.friendName}の操作`}
                                onClose={() => setOpenMenuId(null)}
                                items={items}
                              />
                            </span>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {/* 続きを読めるかぎり読む。読み込み中の失敗は一覧を消さず、再試行口だけ出す。 */}
                {runsMoreError ? (
                  <p className={styles.moreError} role="alert">
                    {runsMoreError}
                    <button type="button" className={styles.sectionLink} onClick={loadMoreRuns}>もう一度読み込む</button>
                  </p>
                ) : null}
                {runs.pagination.nextCursor ? (
                  <div className={styles.more}>
                    <Button onClick={loadMoreRuns} disabled={runsLoadingMore} busy={runsLoadingMore} busyLabel="読み込んでいます…">さらに読み込む</Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </>
      ) : null}

      {/* IDEA-05: 友だちへの配信予定。送信・登録は起きない。 */}
      {planOpen ? (
        <FriendPlanDialog
          scenarioId={id}
          lineAccountId={scenario?.lineAccountId ?? selectedAccountId ?? null}
          initialFriend={planFriend}
          onClose={() => setPlanOpen(false)}
        />
      ) : null}

      {/* 「別のシナリオへ移す」の窓。移し先は稼働中の別シナリオだけ選べる。 */}
      <Dialog
        open={moveTarget !== null}
        title={moveTarget ? `${moveTarget.friendName} を別のシナリオへ移す` : ''}
        description="いまのシナリオはここで終わり、選んだシナリオの最初から届き始めます。"
        busy={opBusy !== null}
        error={moveTarget ? opError : ''}
        onCancel={closeMove}
        footer={(
          <div className={styles.dialogButtons}>
            <Button type="button" onClick={closeMove} disabled={opBusy !== null}>キャンセル</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!moveScenarioId || opBusy !== null}
              onClick={() => void confirmMove()}
              busy={opBusy !== null}
              busyLabel="移しています…"
            >
              このシナリオへ移す
            </Button>
          </div>
        )}
      >
        {/* 候補の取得失敗は「移せるシナリオがありません」と分ける（SCENARIO-10 と同じ分け方）。 */}
        {moveOptionsError ? (
          <p className={styles.moreError} role="alert">
            移し先の候補を読み込めませんでした。
            <button type="button" className={styles.sectionLink} onClick={() => void loadMoveOptions()} disabled={opBusy !== null}>
              もう一度読み込む
            </button>
          </p>
        ) : (
          <Select
            value={moveScenarioId}
            disabled={moveOptions === null || moveChoices.length === 0 || opBusy !== null}
            onChange={(value) => setMoveScenarioId(value)}
            aria-label="移し先のシナリオ"
            size="full"
            options={[
              {
                value: '',
                label: moveOptions === null
                  ? '読み込んでいます'
                  : moveChoices.length === 0
                    ? '稼働中の他のシナリオがありません'
                    : 'シナリオを選んでください',
              },
              ...moveChoices.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        )}
      </Dialog>
    </DetailPage>
  )
}
