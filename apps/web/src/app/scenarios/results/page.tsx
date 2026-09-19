'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Scenario, ScenarioStats, ScenarioStep } from '@line-crm/shared'
import { api, type ScenarioRuns } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import SelectField from '@/components/shared/select-field'
import styles from './scenario-results.module.css'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }
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

function ResultsInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [runs, setRuns] = useState<ScenarioRuns | null>(null)
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
  const opKeys = useRef(new IdempotencyKeyStore())

  usePageTitle(scenario ? `シナリオ結果：${scenario.name}` : null)

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false)
      setError('配信結果を確認するシナリオが指定されていません。')
      return
    }
    setLoading(true)
    setError('')
    setScenario(null)
    setStats(null)
    setRuns(null)
    try {
      const [scenarioResponse, statsResponse, runsResponse] = await Promise.all([
        scenarioReferenceData.scenario(id),
        scenarioReferenceData.stats(id),
        selectedAccountId
          ? api.scenarios.runs(id, selectedAccountId, { limit: 50 }).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!scenarioResponse.success || !statsResponse.success) throw new Error('load failed')
      setScenario(scenarioResponse.data)
      setStats(statsResponse.data)
      setRuns(runsResponse?.success ? runsResponse.data : null)
    } catch {
      setError('配信結果を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

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
      await load()
    } catch {
      setOpError(`${subscription.friendName} への操作を完了できませんでした。時間を置いてもう一度お試しください。`)
    } finally {
      setOpBusy(null)
    }
  }

  /** 「移す」の窓を開く。移し先の候補は、いま配っているシナリオ以外の稼働中だけ。 */
  const openMoveDialog = async (subscription: { id: string; friendName: string }) => {
    setMoveTarget({ subscriptionId: subscription.id, friendName: subscription.friendName })
    setMoveScenarioId('')
    setOpError('')
    if (moveOptions === null) {
      const res = await api.scenarios.list({ accountId: selectedAccountId || undefined }).catch(() => null)
      setMoveOptions(res?.success ? res.data : [])
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
      await load()
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
      {!loading && error ? <ListState kind="error" description={error} onRetry={() => void load()} /> : null}

      {!loading && !error && scenario && stats ? (
        <div className={styles.columns}>
          <main className={styles.main}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>配信結果</h2>
                <p>開始・完了・どの通まで届いたかを確認します。</p>
              </div>
              <div className={styles.resultSummary}>
                <SummaryCard variant="v6" title="開始" value={stats.enrolledTotal} unit="人" detail="このシナリオに参加した人数" />
                <SummaryCard variant="v6" title="完了" value={stats.completed} unit="人" detail={percentLabel(stats.completed, stats.enrolledTotal)} />
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>ステップ別の反応</h2>
                <p>到達人数と、前の通から減った場所を確認できます。</p>
              </div>
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
            </section>

            {/*
              友だち単位の購読操作（#949 N-054）。止める・再開・失敗を再送・
              別のシナリオへ移す。止まり方（pauseReason）で「再開」と
              「失敗を再送」を出し分ける。
            */}
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>参加中の友だち</h2>
                <p>届いている・止まっている購読を友だちごとに操作します。</p>
              </div>
              {opError ? <NoteBar tone="warn">{opError}</NoteBar> : null}
              {!runs || runs.subscriptions.length === 0 ? (
                <ListState
                  kind="empty"
                  title="購読している友だちはまだいません"
                  description="開始条件に一致した友だちがここに並びます。"
                />
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>友だち</th>
                        <th>状態</th>
                        <th>次の配信</th>
                        <th aria-label="操作" />
                      </tr>
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
                          <tr key={sub.id}>
                            <td className={styles.friendCell}>{sub.friendName}</td>
                            <td>
                              <span className={`${styles.stateBadge} ${pausedByFailure ? styles.stateBadgeWarn : ''}`}>
                                {stateLabel}
                              </span>
                            </td>
                            <td className={styles.nowrap}>
                              {sub.status === 'completed'
                                ? '—'
                                : sub.nextDeliveryAt ?? '—'}
                            </td>
                            <td>
                              <div className={styles.rowActions}>
                                {sub.status === 'active' ? (
                                  <button
                                    type="button"
                                    disabled={opBusy !== null}
                                    onClick={() => void runSubscriptionOp(sub, 'pause')}
                                  >
                                    {opBusy === `${sub.id}:pause` ? '停止中…' : '止める'}
                                  </button>
                                ) : null}
                                {sub.status === 'paused' ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={opBusy !== null}
                                      onClick={() => void runSubscriptionOp(sub, 'resume')}
                                    >
                                      {opBusy === `${sub.id}:resume` ? '再開中…' : '再開'}
                                    </button>
                                    {pausedByFailure ? (
                                      <button
                                        type="button"
                                        disabled={opBusy !== null}
                                        onClick={() => void runSubscriptionOp(sub, 'retry')}
                                      >
                                        {opBusy === `${sub.id}:retry` ? '再送中…' : '失敗を再送'}
                                      </button>
                                    ) : null}
                                  </>
                                ) : null}
                                {sub.status === 'active' || sub.status === 'paused' ? (
                                  <button
                                    type="button"
                                    disabled={opBusy !== null}
                                    onClick={() => void openMoveDialog(sub)}
                                  >
                                    別のシナリオへ移す
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </main>

          <aside className={styles.side}>
            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>設定サマリー</h2><p>現在の参加状況です。</p></div>
              <dl className={styles.summaryList}>
                <div><dt>参加中</dt><dd>{(runs ? runs.summary.active + runs.summary.delivering : stats.activeNow).toLocaleString('ja-JP')}人</dd></div>
                <div><dt>完了</dt><dd>{(runs?.summary.completed ?? stats.completed).toLocaleString('ja-JP')}人</dd></div>
                <div><dt>一時停止</dt><dd>{(runs?.summary.paused ?? stats.paused).toLocaleString('ja-JP')}人</dd></div>
                <div><dt>エラー</dt><dd>—</dd></div>
              </dl>
              <p className={styles.unavailable}>
                {runs?.steps[0]?.failed.reason ?? '配信失敗数は、この集計からは取得できません。'}
              </p>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>メッセージプレビュー</h2><p>1通目に登録されている内容です。</p></div>
              <div className={styles.preview}>{messagePreview(sortedSteps[0])}</div>
            </section>
          </aside>
        </div>
      ) : null}

      {/* 「別のシナリオへ移す」の窓。移し先は稼働中の別シナリオだけ選べる。 */}
      {moveTarget ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="move-dialog-title">
          <div className={styles.modal}>
            <h2 id="move-dialog-title" className={styles.modalTitle}>
              {moveTarget.friendName} を別のシナリオへ移す
            </h2>
            <p className={styles.modalLead}>
              いまのシナリオはここで終わり、選んだシナリオの最初から届き始めます。
            </p>
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
              className={styles.select}
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
            {opError ? <p className={styles.modalError}>{opError}</p> : null}
            <div className={styles.modalActions}>
              <Button
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
                variant="primary"
                disabled={!moveScenarioId || opBusy !== null}
                onClick={() => void confirmMove()}
              >
                {opBusy ? '移しています…' : 'このシナリオへ移す'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
