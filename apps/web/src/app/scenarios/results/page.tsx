'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Scenario, ScenarioStats, ScenarioStep } from '@line-crm/shared'
import { api } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import styles from './scenario-results.module.css'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }
function percentLabel(value: number, total: number): string {
  if (total === 0) return '0.0%'
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
  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
    try {
      const [scenarioResponse, statsResponse] = await Promise.all([
        api.scenarios.get(id),
        api.scenarios.stats(id),
      ])
      if (!scenarioResponse.success || !statsResponse.success) throw new Error('load failed')
      setScenario(scenarioResponse.data)
      setStats(statsResponse.data)
    } catch {
      setError('配信結果を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const sortedSteps = useMemo(
    () => [...(scenario?.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder),
    [scenario],
  )
  const statsByOrder = useMemo(
    () => new Map((stats?.steps ?? []).map((step) => [step.stepOrder, step])),
    [stats],
  )

  const exportCsv = () => {
    if (!scenario || !stats) return
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
              <NoteBar tone="info">LINEでは友だち単位の開封を取得できません。クリック率も、この集計にはまだ接続していません。</NoteBar>
              {sortedSteps.length === 0 ? (
                <ListState kind="empty" title="配信内容がまだありません" description="シナリオ編集からメッセージを追加してください。" />
              ) : (
                <ol className={styles.steps}>
                  {sortedSteps.map((step) => {
                    const result = statsByOrder.get(step.stepOrder)
                    return (
                      <li key={step.id} className={styles.step}>
                        <div className={styles.stepTitle}>
                          <span>ステップ{step.stepOrder}：{scheduleLabel(step)}</span>
                          <span className={styles.reached}>{result?.reachedCount.toLocaleString('ja-JP') ?? '—'}人到達</span>
                        </div>
                        <p>到達率 {result ? percentLabel(result.reachedCount, stats.enrolledTotal) : '—'}・開封率 —・クリック率 —</p>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          </main>

          <aside className={styles.side}>
            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>設定サマリー</h2><p>現在の参加状況です。</p></div>
              <dl className={styles.summaryList}>
                <div><dt>参加中</dt><dd>{stats.activeNow.toLocaleString('ja-JP')}人</dd></div>
                <div><dt>完了</dt><dd>{stats.completed.toLocaleString('ja-JP')}人</dd></div>
                <div><dt>一時停止</dt><dd>{stats.paused.toLocaleString('ja-JP')}人</dd></div>
                <div><dt>エラー</dt><dd>—</dd></div>
              </dl>
              <p className={styles.unavailable}>配信失敗数は、この集計からは取得できません。</p>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>メッセージプレビュー</h2><p>1通目に登録されている内容です。</p></div>
              <div className={styles.preview}>{messagePreview(sortedSteps[0])}</div>
            </section>
          </aside>
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
