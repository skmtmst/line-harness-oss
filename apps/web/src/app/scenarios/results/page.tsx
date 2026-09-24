'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Scenario, ScenarioStats, ScenarioStep } from '@line-crm/shared'
import { api, type ScenarioRuns } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { MoreHorizontal } from 'lucide-react'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import styles from './scenario-results.module.css'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import { FriendPlanDialog } from '@/components/scenarios/scenario-dialogs'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }

/** 購読一覧の1ページぶん。サーバーの上限は100、画面の既定は50。 */
const RUNS_PAGE_SIZE = 50

/*
 * 到達率。分母が 0（まだ誰も参加していない）ときは「0.0%」にしない。
 * 測って 0 なのか、測れていないのか区別できなくなる（#495 軽19）。
 */
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

function messagePreview(step: ScenarioStep | undefined): string {
  if (!step) return '配信内容はまだありません。'
  if (step.messageType === 'text') return step.messageContent || '本文は未設定です。'
  const labels: Record<string, string> = {
    image: '画像メッセージ', flex: 'カードタイプのメッセージ', carousel: 'カルーセル',
    location: '位置情報', video: '動画', audio: '音声', sticker: 'スタンプ',
  }
  return labels[step.messageType] ?? '登録したメッセージ'
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

/** この画面のパネル。見出しと説明文の組を毎回同じ構造で置く。 */
function Panel({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>{title}</h2>
        <p>{lead}</p>
      </div>
      {children}
    </section>
  )
}

function ResultsInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [stats, setStats] = useState<ScenarioStats | null>(null)
  /*
   * SCENARIO-13: 配信記録（runs）はシナリオ本体・集計とは別の流れで読む。
   * Promise.all でまとめて待つと、遅い補助データのせいで本文まで出ない。
   * SCENARIO-10: runs の取得失敗は「0件」と分けて、読み直し口を出す。
   */
  const [runs, setRuns] = useState<ScenarioRuns | null>(null)
  const [runsState, setRunsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('loading')
  /** 続きのページを読んでいる間。初回の読み込みとは分ける。 */
  const [runsLoadingMore, setRunsLoadingMore] = useState(false)
  const [runsMoreError, setRunsMoreError] = useState('')
  /*
   * SCENARIO-12: 状態の絞り込みはサーバー側で全件へ掛ける。
   * 手元の1ページだけを絞ると「全体で51人いるのに50人しか居ない」ように見える。
   */
  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /*
   * 友だち単位の操作（#949 N-054）。止める・再開・失敗を再送・移す。
   * busy は「購読ID:操作」で持ち、押した行だけを止める。
   * 確認キーは署名ごとに持ち、成功した操作だけクリアする——失敗した
   * 再試行は同じキーで送り、サーバ側で同じ操作として処理される。
   */
  const [opBusy, setOpBusy] = useState<string | null>(null)
  const [opError, setOpError] = useState('')
  const [moveTarget, setMoveTarget] = useState<{ subscriptionId: string; friendName: string } | null>(null)
  const [moveScenarioId, setMoveScenarioId] = useState('')
  const [moveOptions, setMoveOptions] = useState<Scenario[] | null>(null)
  /** 移し先候補の取得失敗。0件と取り違えないよう別に持つ（SCENARIO-10と同じ分け方）。 */
  const [moveOptionsError, setMoveOptionsError] = useState(false)
  /*
   * IDEA-05: 選んだ検証顧客への配信予定・待機・分岐理由を、送信なしで
   * 確かめる窓。行から開くとその人を、パネル頭の入口から開くと
   * まだ開始していない検証用の友だちも選べる。
   */
  const [planOpen, setPlanOpen] = useState(false)
  const [planFriend, setPlanFriend] = useState<{ id: string; name: string } | null>(null)
  // 行の「その他」メニューの開き先（#641）
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const opKeys = useRef(new IdempotencyKeyStore())

  usePageTitle(scenario ? `シナリオ結果：${scenario.name}` : null)

  /*
   * SCENARIO-11: 画面（id）やアカウントを切り替えたあとに返ってきた
   * 古い応答を新しい対象へ書き込まないための世代番号。
   * 切替のたびに進め、飛んでいる古い応答は全部捨てる。
   */
  const loadSeqRef = useRef(0)

  /** シナリオ本体と集計。ここだけ先に読めれば本文は見せられる。 */
  const loadMain = useCallback(async (seq: number) => {
    if (!id) {
      setLoading(false)
      setError('配信結果を確認するシナリオが指定されていません。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const [scenarioResponse, statsResponse] = await Promise.all([
        scenarioReferenceData.scenario(id),
        scenarioReferenceData.stats(id),
      ])
      if (seq !== loadSeqRef.current) return
      if (!scenarioResponse.success || !statsResponse.success) throw new Error('load failed')
      setScenario(scenarioResponse.data)
      setStats(statsResponse.data)
    } catch {
      if (seq !== loadSeqRef.current) return
      setError('配信結果を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [id])

  /*
   * SCENARIO-12: 購読一覧は50件ずつカーソルで辿る。
   * `pagination.nextCursor` が返るかぎり続きがあり、
   * `pagination.total` は絞り込みを通ったあとの全件数。
   * 続きのページは購読の行だけを後ろへ足し、集計・通別結果・送信枠は
   * 新しい応答のものへ置き換える（各ページ同じ値が返る）。
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

  /** 購読一覧だけを読み直す。再試行と操作後の更新はこの領域に限定する（SCENARIO-13）。 */
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
    /*
     * 到達率の分母は集計（stats）の参加人数で統一する。画面の人数表示は
     * 実行記録（runs）を優先する箇所があるが、CSV は runs が取れない
     * 環境でも同じ数になるよう stats 基準にする（#495 軽19）。
     */
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
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
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
      // 操作後の更新は購読一覧と集計だけ。画面全体は読み直さない（SCENARIO-13）。
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

  /** 「移す」の窓を開く。移し先の候補は、いま配っているシナリオ以外の稼働中だけ。 */
  const openMoveDialog = async (subscription: { id: string; friendName: string }) => {
    setMoveTarget({ subscriptionId: subscription.id, friendName: subscription.friendName })
    setMoveScenarioId('')
    setOpError('')
    if (moveOptions === null) {
      await loadMoveOptions()
    }
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

  const moveChoices = (moveOptions ?? []).filter((item) => item.id !== id && item.isActive)

  return (
    <div className={styles.page} data-design-node="M2b2B">
      <div className={styles.actions}>
        <Link href="/scenarios" className={styles.crumb}>← シナリオ一覧</Link>
        <span className={styles.actionEnd}>
          <Button href={`/scenarios/detail?id=${id}`}>シナリオ編集へ戻る</Button>
          {/*
            **書き出しは主要ボタンにしない。**
            横断レビュー §7 の #44。この画面でいちばんしたいことは結果を見ることで、
            CSVに落とすことではない。緑にすると、そちらが本筋に見える。
            ほかの7画面はすべて副次で置いてあり、ここだけ例外だった。
          */}
          <Button onClick={exportCsv} disabled={!scenario || !stats}>CSVで書き出す</Button>
        </span>
      </div>

      {loading ? <ListState kind="loading" title="配信結果を読み込んでいます" /> : null}
      {!loading && error ? <ListState kind="error" description={error} onRetry={() => void loadMain(loadSeqRef.current)} /> : null}

      {!loading && !error && scenario && stats ? (
        <div className={styles.columns}>
          <div className={styles.main}>
            <Panel title="配信結果" lead="開始・完了・どの通まで届いたかを確認します。">
              <div className={styles.resultSummary}>
                <SummaryCard variant="v6" title="開始" value={stats.enrolledTotal} unit="人" detail="このシナリオに参加した人数" />
                <SummaryCard variant="v6" title="完了" value={stats.completed} unit="人" detail={percentLabel(stats.completed, stats.enrolledTotal)} />
              </div>
            </Panel>

            <Panel title="ステップ別の反応" lead="到達人数と、前の通から減った場所を確認できます。">
              <NoteBar tone="info">LINEでは通ごとの開封・クリック・失敗をすべて取得できません。取得できない指標は「—」で表示します。</NoteBar>
              {sortedSteps.length === 0 ? (
                <ListState kind="empty" title="配信内容がまだありません" description="シナリオ編集からメッセージを追加してください。" />
              ) : (
                <ol className={styles.steps}>
                  {sortedSteps.map((step) => {
                    const result = statsByOrder.get(step.stepOrder)
                    const run = runsByOrder.get(step.stepOrder)
                    return (
                      <li key={step.id} className={styles.step}>
                        <div className={styles.stepTitle}>
                          <span>ステップ{step.stepOrder}：{scheduleLabel(step)}</span>
                          <span className={styles.reached}>{(run?.delivered ?? result?.reachedCount)?.toLocaleString('ja-JP') ?? '—'}人到達</span>
                        </div>
                        <p>
                          到達率 {run ? percentLabel(run.delivered, stats.enrolledTotal) : result ? percentLabel(result.reachedCount, stats.enrolledTotal) : '—'}
                          {'・'}開封率 {run?.opened.value ?? '—'}
                          {'・'}クリック率 {run?.clicked.value ?? '—'}
                        </p>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Panel>

            {/*
              友だち単位の購読操作（#949 N-054）。止める・再開・失敗を再送・
              別のシナリオへ移す。止まり方（pauseReason）で「再開」と
              「失敗を再送」を出し分ける。
            */}
            <Panel title="参加中の友だち" lead="届いている・止まっている購読を友だちごとに操作します。">
              {opError ? <NoteBar tone="warn">{opError}</NoteBar> : null}
              <div className="mb-3">
                <Button
                  type="button"
                  onClick={() => {
                    setPlanFriend(null)
                    setPlanOpen(true)
                  }}
                >
                  友だちを選んで配信予定を見る
                </Button>
              </div>
              {/*
                SCENARIO-12: 状態の絞り込みはサーバーへ渡して全件へ掛ける。
                手元の表示中ページだけを絞ると、総件数と食い違う。
              */}
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <SelectField
                  size="compact"
                  value={subscriptionStatus}
                  onChange={(event) => setSubscriptionStatus(event.target.value)}
                  aria-label="購読の状態で絞り込む"
                  options={[
                    { value: '', label: 'すべての状態' },
                    { value: 'active', label: '配信中' },
                    { value: 'delivering', label: '送信中' },
                    { value: 'paused', label: '停止中' },
                    { value: 'completed', label: '完了' },
                  ]}
                />
                {runs ? (
                  <span className="text-ink-faint text-xs tabular-nums">
                    {runs.subscriptions.length.toLocaleString('ja-JP')} / {runs.pagination.total.toLocaleString('ja-JP')}人
                  </span>
                ) : null}
              </div>
              {/*
                SCENARIO-10: 取得失敗と「まだ誰もいない」を分ける。
                失敗は再試行、未取得（アカウント未選択）は案内、
                正常に0件のときだけ空状態を出す。
              */}
              {runsState === 'idle' ? (
                <p className="text-ink-faint py-6 text-center text-sm">
                  上部のLINEアカウントを選ぶと、購読している友だちの一覧を表示します。
                </p>
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
                <DataTable>
                  <thead>
                    <TableHeadRow>
                      <Th>友だち</Th>
                      <Th className="w-32">状態</Th>
                      <Th className="w-44">次の配信</Th>
                      <Th className="w-72" align="right">操作</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {runs.subscriptions.map((sub) => {
                      const pausedByFailure = sub.status === 'paused' && sub.pauseReason === 'delivery_failed'
                      const stateLabel =
                        sub.status === 'active'
                          ? '配信中'
                          : sub.status === 'delivering'
                            ? '送信中'
                            : sub.status === 'completed'
                              ? '完了'
                              : pausedByFailure
                                ? '配信失敗で停止中'
                                : '停止中'
                      return (
                        <Tr key={sub.id}>
                          <Td>
                            <span className="block max-w-56 truncate text-label text-ink" title={sub.friendName}>
                              {sub.friendName}
                            </span>
                          </Td>
                          <Td>
                            <StatusBadge tone={pausedByFailure ? 'warning' : 'neutral'} size="compact">
                              {stateLabel}
                            </StatusBadge>
                          </Td>
                          <Td className="whitespace-nowrap">
                            {sub.status === 'completed'
                              ? '—'
                              : sub.nextDeliveryAt ?? '—'}
                          </Td>
                          <ActionCell>
                            {/* #641: 主操作は枠つき「予定を見る」、購読操作は「その他（…）」へ集約。 */}
                            <div className="relative inline-flex items-center justify-end gap-1.5">
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setPlanFriend({ id: sub.friendId, name: sub.friendName })
                                  setPlanOpen(true)
                                }}
                              >
                                予定を見る
                              </Button>
                              {sub.status === 'active' || sub.status === 'paused' ? (
                                <>
                                  <IconButton
                                    aria-label={`${sub.friendName}のその他操作`}
                                    aria-expanded={openMenuId === sub.id}
                                    onClick={() =>
                                      setOpenMenuId((current) => (current === sub.id ? null : sub.id))
                                    }
                                  >
                                    <MoreHorizontal aria-hidden />
                                  </IconButton>
                                  <ActionMenu
                                    open={openMenuId === sub.id}
                                    ariaLabel={`${sub.friendName}の操作`}
                                    onClose={() => setOpenMenuId(null)}
                                    items={(() => {
                                      const items: ActionMenuItem[] = []
                                      if (sub.status === 'active') {
                                        items.push({
                                          id: 'pause',
                                          label: opBusy === `${sub.id}:pause` ? '停止中…' : '止める',
                                          disabled: opBusy !== null,
                                          onSelect: () => void runSubscriptionOp(sub, 'pause'),
                                        })
                                      }
                                      if (sub.status === 'paused') {
                                        items.push({
                                          id: 'resume',
                                          label: opBusy === `${sub.id}:resume` ? '再開中…' : '再開',
                                          disabled: opBusy !== null,
                                          onSelect: () => void runSubscriptionOp(sub, 'resume'),
                                        })
                                        if (pausedByFailure) {
                                          items.push({
                                            id: 'retry',
                                            label: opBusy === `${sub.id}:retry` ? '再送中…' : '失敗を再送',
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
                                      return items
                                    })()}
                                  />
                                </>
                              ) : null}
                            </div>
                          </ActionCell>
                        </Tr>
                      )
                    })}
                  </tbody>
                </DataTable>
                {/*
                  SCENARIO-12: `nextCursor` が残っているかぎり続きを読める。
                  読み込み中の失敗は一覧を消さず、直前の行を残したまま
                  再試行口だけ出す。
                */}
                {runsMoreError ? (
                  <p className="text-danger mt-3 flex flex-wrap items-center gap-3 text-xs" role="alert">
                    {runsMoreError}
                    <button
                      type="button"
                      className="text-info font-medium hover:underline"
                      onClick={loadMoreRuns}
                    >
                      もう一度読み込む
                    </button>
                  </p>
                ) : null}
                {runs.pagination.nextCursor ? (
                  <div className="mt-3 flex justify-center">
                    <Button onClick={loadMoreRuns} disabled={runsLoadingMore}>
                      {runsLoadingMore ? '読み込んでいます…' : 'さらに読み込む'}
                    </Button>
                  </div>
                ) : null}
              </>
              )}
            </Panel>
          </div>

          <aside className={styles.side}>
            <Panel title="設定サマリー" lead="現在の参加状況です。">
              <dl className={styles.summaryList}>
                <div><dt>参加中</dt><dd>{(runs ? runs.summary.active + runs.summary.delivering : stats.activeNow).toLocaleString('ja-JP')}人</dd></div>
                <div><dt>完了</dt><dd>{(runs?.summary.completed ?? stats.completed).toLocaleString('ja-JP')}人</dd></div>
                <div><dt>一時停止</dt><dd>{(runs?.summary.paused ?? stats.paused).toLocaleString('ja-JP')}人</dd></div>
                <div><dt>エラー</dt><dd>—</dd></div>
              </dl>
              <p className={styles.unavailable}>
                {runs?.steps[0]?.failed.reason ?? '配信失敗数は、この集計からは取得できません。'}
              </p>
            </Panel>

            <Panel title="メッセージプレビュー" lead="1通目に登録されている内容です。">
              <div className={styles.preview}>{messagePreview(sortedSteps[0])}</div>
            </Panel>
          </aside>
        </div>
      ) : null}

      {/* IDEA-05: 検証顧客への配信予定。送信・登録は起きない。 */}
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
        onCancel={() => {
          if (opBusy) return
          setMoveTarget(null)
          setOpError('')
        }}
        footer={(
          <div className="border-hairline flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              onClick={() => {
                if (opBusy) return
                setMoveTarget(null)
                setOpError('')
              }}
              disabled={opBusy !== null}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!moveScenarioId || opBusy !== null}
              onClick={() => void confirmMove()}
            >
              {opBusy ? '移しています…' : 'このシナリオへ移す'}
            </Button>
          </div>
        )}
      >
        {/*
          候補の取得失敗は「移せるシナリオがありません」と分ける。
          0件と見せると、存在する移し先まで無いと思われる（SCENARIO-10と同じ分け方）。
        */}
        {moveOptionsError ? (
          <p className="text-danger flex flex-wrap items-center gap-3 text-sm" role="alert">
            移し先の候補を読み込めませんでした。
            <button
              type="button"
              className="text-info font-medium hover:underline"
              onClick={() => void loadMoveOptions()}
              disabled={opBusy !== null}
            >
              もう一度読み込む
            </button>
          </p>
        ) : (
          <SelectField
            value={moveScenarioId}
            title={moveOptions === null
              ? '読み込んでいます'
              : moveChoices.length === 0
                ? '移せるシナリオがありません'
                : '移し先のシナリオを選んでください'}
            disabled={moveOptions === null || moveChoices.length === 0 || opBusy !== null}
            onChange={(event) => setMoveScenarioId(event.target.value)}
            aria-label="移し先のシナリオ"
            className="w-full"
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
    </div>
  )
}

export default function ScenarioResultsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="配信結果を読み込んでいます" />}>
      <ResultsInner />
    </Suspense>
  )
}
