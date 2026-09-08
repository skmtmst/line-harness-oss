'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api, type AnalyticsFunnelRunResult } from '@/lib/api'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
import KpiCard from '@/components/shared/kpi-card'
import { formatAnalyticsDateTime } from '../analytics-time'
import {
  AnalyticsExportButton,
  AnalyticsNotice,
  SaveAnalysisAction,
  downloadCsv,
  explainStartError,
} from './analytics-shared'

export function FunnelTab({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const [funnels, setFunnels] = useState<
    Array<{
      id: string
      name: string
      windowDays: number
      createdAt: string
      currentVersion: { id: string; versionNumber: number; createdAt: string } | null
      migrationState: 'ready' | 'needs_migration'
    }>
  >([])
  const [selected, setSelected] = useState('')
  const [run, setRun] = useState<AnalyticsFunnelRunResult | null>(null)
  const [groupKey, setGroupKey] = useState('all')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  // まだ1度も集計していない状態。壊れているのか未集計なのか分ける(点検#508軽13)。
  const [noRun, setNoRun] = useState(false)
  // 一覧の取得失敗は空表示と分ける。失敗したまま「まだありません」と出すと、
  // あるものを無いと勘違いして作り直す(点検#508の中3)。
  const [listError, setListError] = useState('')
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [funnelAudience, setFunnelAudience] = useState<{ id: string; memberCount: number; expiresAt: string } | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setListError('')
    setFunnels([])
    setSelected('')
    setRun(null)
    setGroupKey('all')
    setPicked(null)
    setFunnelAudience(null)
    void api.analytics.v6Funnels
      .list(accountId)
      .then((res) => {
        if (!active) return
        if (res.success) {
          setFunnels(res.data)
          if (res.data.length > 0) setSelected(res.data[0].id)
        } else {
          setListError(res.error || 'ファネルを読み込めませんでした')
        }
      })
      .catch(() => {
        if (active) setListError('ファネルを読み込めませんでした')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountId])

  useEffect(() => {
    if (!selected) return
    let active = true
    setPicked(null)
    setFunnelAudience(null)
    setRun(null)
    setRunError('')
    setNoRun(false)
    void api.analytics.v6Funnels.latestRun(accountId, selected).then((res) => {
      if (!active) return
      if (res.success) {
        setRun(res.data)
        setGroupKey(res.data.groups[0]?.key ?? 'all')
      }
      else if (res.error === 'Not found') setNoRun(true)
      else setRunError(res.error)
    })
    return () => {
      active = false
    }
  }, [accountId, selected])

  const runNow = async () => {
    if (!selected) return
    setRunning(true)
    setRunError('')
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 3600_000)
    try {
      const response = await api.analytics.v6Funnels.run(accountId, selected, {
        cohortFrom: from.toISOString(),
        cohortTo: now.toISOString(),
      })
      if (!response.success) throw new Error(response.error)
      setRun(response.data)
      setGroupKey(response.data.groups[0]?.key ?? 'all')
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setRunError(explainStartError(code, code || '再集計できませんでした'))
    } finally {
      setRunning(false)
    }
  }

  const activeGroup = run?.groups.find((group) => group.key === groupKey) ?? run?.groups[0] ?? null
  const result = activeGroup?.steps ?? null

  const comparisonGap = useMemo(() => {
    if (!run || run.groups.length < 2) return null
    let largest = 0
    for (let index = 0; index < run.groups[0].steps.length; index += 1) {
      const rates = run.groups
        .map((group) => group.steps[index]?.conversionFromPrevious)
        .filter((value): value is number => value !== null && value !== undefined)
      if (rates.length < 2) continue
      largest = Math.max(largest, Math.max(...rates) - Math.min(...rates))
    }
    return Math.round(largest * 1000) / 10
  }, [run])

  const prepareFunnelAudience = async () => {
    if (!run?.runId || picked === null || !result?.[picked - 1] || !activeGroup) return
    setRunError('')
    try {
      const response = await api.analytics.createResultAudience(accountId, run.runId, {
        sourceKind: 'funnel',
        groupKey: activeGroup.key,
        stepOrder: result[picked - 1].stepOrder,
        selection: 'stopped',
      })
      if (!response.success) throw new Error(response.error)
      setFunnelAudience(response.data)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '対象者を準備できませんでした')
    }
  }

  // いちばん落ちる段。人数の差ではなく、落ちた割合で選ぶ。母数の大きい段が
  // いつも1位になってしまうため。
  const worst = useMemo(() => {
    if (!result || result.length < 2) return null
    let found: { index: number; lost: number; rate: number } | null = null
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1].reached
      if (prev === 0) continue
      const lost = prev - result[i].reached
      const rate = lost / prev
      if (!found || rate > found.rate) found = { index: i, lost, rate }
    }
    return found
  }, [result])

  const overall = useMemo(() => {
    if (!result || result.length === 0) return null
    const first = result[0]
    const last = result[result.length - 1]
    return {
      entry: first.reached,
      entryLabel: first.label,
      last: last.reached,
      rate: first.reached > 0 ? Math.round((last.reached / first.reached) * 1000) / 10 : null,
    }
  }, [result])

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        読み込み中...
      </div>
    )
  }

  const top = result?.[0]?.reached ?? 0
  const selectedFunnel = funnels.find((f) => f.id === selected) ?? null
  const exportFunnel = () => {
    if (!result) return
    downloadCsv('analytics-funnel.csv', [
      ['段', '到達した人', '前の段からの通過率', 'ここで止まった人', 'まだ途中の人'],
      ...result.map((step) => [
        step.label,
        step.reached,
        step.conversionFromPrevious === null ? null : `${Math.round(step.conversionFromPrevious * 1000) / 10}%`,
        step.droppedAfter,
        step.inProgressAfter,
      ]),
    ])
  }

  return (
    <div data-design-node="C2I7ry" className="space-y-4">
      <div className="flex justify-end"><AnalyticsExportButton onClick={exportFunnel} disabled={!result} /></div>
      <AnalyticsNotice>段は上から順に見ます。同じ人が同じ段を2回通っても1回として数えます。判定できる期間は、最初の段から設定した日数です。まだ途中の人は完了した人に含めません。</AnalyticsNotice>
      <p className="text-sm text-ink-secondary">友だちがどこまで進んで、どこで離れたかを段階ごとに見ます。段を自由に組み替えられるので、配信の流れでも購入の流れでも作れます。</p>

      {creating ? (
        <FunnelForm
          accountId={accountId}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            void api.analytics.v6Funnels.list(accountId).then((res) => {
              if (res.success) setFunnels(res.data)
            })
            setSelected(id)
          }}
        />
      ) : listError ? (
        <p className="text-danger bg-danger-bg rounded-card border-danger border p-8 text-center text-sm" role="alert">
          ファネルを読み込めませんでした。開き直してください。
        </p>
      ) : funnels.length === 0 ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          ファネルがまだありません。段を2つ以上つないで、どこで離れているかを見られます。
          {canManage ? (
            <button
              onClick={() => setCreating(true)}
              className="text-accent ml-1 hover:underline"
            >
              ＋ 段を足す
            </button>
          ) : (
            <span className="ml-1">作成は統括・管理者へ依頼してください。</span>
          )}
        </p>
      ) : (
        <>
          <section className="bg-canvas rounded-card border-hairline border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-ink text-sm font-semibold">段の並び</h3>
                <p className="text-ink-faint mt-0.5 text-xs">
                  上から順に通った人だけを数えます。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void runNow()} disabled={running} variant="secondary">
                  {running ? '再集計中' : 'この30日を再集計'}
                </Button>
                {canManage && (
                  <button
                    onClick={() => setCreating(true)}
                    className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-xs font-medium"
                  >
                    ＋ 段を足す
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="funnel-select" className="text-ink-secondary mb-1 block text-xs font-medium">
                ファネル
              </label>
              <SelectField
                id="funnel-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                aria-label="ファネル"
                className="border-hairline rounded-control w-full border px-3 py-2 text-sm sm:w-72"
                options={funnels.map((funnel) => ({ value: funnel.id, label: funnel.name }))}
              />
              {selectedFunnel && (
                <p className="text-ink-faint mt-1 text-xs">
                  {selectedFunnel.windowDays}日以内に通った人を数えます。
                  {selectedFunnel.currentVersion
                    ? ` 定義版 ${selectedFunnel.currentVersion.versionNumber}`
                    : ' 現行定義の移行が必要です'}
                </p>
              )}
            </div>

            {result && result.length > 0 && (
              <ol className="mt-3 flex flex-wrap gap-1.5">
                {result.map((step) => (
                  <li
                    key={step.stepOrder}
                    className="border-hairline text-ink-secondary rounded-pill border px-3 py-1 text-xs"
                  >
                    {step.label}
                  </li>
                ))}
              </ol>
            )}

            {/* 条件ごとに通過率を並べる仕組みが無い。ファネルの定義が1本の
                段の列だけで、条件で分ける口を持っていない。 */}
            {run && <p className="text-ink-faint mt-2 text-xs">
              集計期間 {new Date(run.cohortFrom).toLocaleDateString('ja-JP')}〜{new Date(run.cohortTo).toLocaleDateString('ja-JP')}
              ／データ締切 {formatAnalyticsDateTime(run.dataCutoffAt)}
            </p>}
            {runError && <p className="text-danger mt-2 text-xs">{runError}</p>}
            {noRun && !run && <p className="text-ink-faint mt-2 text-xs">まだ集計がありません。「この30日を再集計」を押してください</p>}
            {run?.stateReason && <p className="text-warning mt-2 text-xs">{run.stateReason}</p>}
            {run && run.groups.length > 1 && (
              <div className="mt-3 max-w-xs">
                <label htmlFor="funnel-group" className="text-ink-secondary mb-1 block text-xs font-medium">比較する条件</label>
                <SelectField
                  id="funnel-group"
                  value={groupKey}
                  onChange={(event) => setGroupKey(event.target.value)}
                  aria-label="比較する条件"
                  className="v6-select w-full"
                  options={run.groups.map((group) => ({
                    value: group.key,
                    label: `${group.label}（入口 ${group.entrants}人）`,
                  }))}
                />
              </div>
            )}
          </section>

          <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              title="入口"
              value={overall?.entry ?? null}
              unit="人"
              detail={overall?.entryLabel ?? '—'}
            />
            <KpiCard
              title="最後まで"
              value={overall?.last ?? null}
              unit="人"
              detail={overall?.rate != null ? `通過率 ${overall.rate}%` : '—'}
            />
            <KpiCard
              title="いちばん落ちる段"
              value={worst ? Math.round(worst.rate * 100) : null}
              unit="%"
              detail={
                worst && result
                  ? `${result[worst.index - 1].label} → ${result[worst.index].label}`
                  : '—'
              }
            />
            {/* 段ごとの到達日時を持っていない。ファネルの集計は「通ったか」
                だけを見ていて、いつ通ったかを残していない。 */}
            <KpiCard title="平均の到達日数" value={null} unit="日" detail="入口から最後まで" />
            <KpiCard
              title="比較で差が大きい段"
              value={comparisonGap}
              unit="pt"
              detail={run && run.groups.length > 1 ? `${run.groups.length}条件を比較` : '比較条件なし'}
            />
          </div>

          {result && (
            <section className="bg-canvas rounded-card border-hairline border p-5">
              <h3 className="text-ink text-sm font-semibold">全体の流れ</h3>
              <p className="text-ink-faint mt-0.5 mb-3 text-xs">
                かっこ内はひとつ前の段からの通過率
              </p>
              <div className="space-y-3">
                {result.map((step, i) => {
                  const prev = i > 0 ? result[i - 1].reached : null
                  const lost = prev != null ? prev - step.reached : 0
                  const isWorst = worst?.index === i
                  return (
                    <div key={step.stepOrder}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <p className="text-ink text-sm font-medium">
                          {i + 1}. {step.label}
                        </p>
                        <p className="text-ink-secondary text-sm tabular-nums">
                          {step.reached.toLocaleString('ja-JP')} 人
                          {i > 0 && (
                            <span className="text-ink-faint ml-2 text-xs">
                              （{step.conversionFromPrevious == null ? '—' : `${Math.round(step.conversionFromPrevious * 1000) / 10}%`}）
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setFunnelAudience(null)
                          setPicked(lost > 0 ? i : null)
                        }}
                        disabled={lost <= 0}
                        className="bg-canvas-sunken block h-6 w-full overflow-hidden rounded text-left"
                        aria-label={`${step.label}の段`}
                      >
                        <span
                          className={`block h-full ${isWorst ? 'bg-warning' : 'bg-accent'}`}
                          style={{ width: top > 0 ? `${(step.reached / top) * 100}%` : '0%' }}
                        />
                      </button>
                      {/* 落ちた人数と割合は数えられる。「案内が届いていない
                          可能性があります」のような原因は、運用を知らないと
                          書けないので出さない。 */}
                      {prev != null && lost > 0 && (
                        <p className={`mt-1 text-xs ${isWorst ? 'text-warning' : 'text-ink-faint'}`}>
                          {lost.toLocaleString('ja-JP')}人（
                          {Math.round((lost / prev) * 1000) / 10}%）がここで止まっています。
                          {isWorst && ' この分析でいちばん落ちる段です。'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="border-hairline mt-4 border-t pt-3">
                {picked != null && result[picked] ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-ink text-sm">
                      「{result[picked - 1]?.label}まで進んで{result[picked].label}に至っていない{' '}
                      {(result[picked - 1].reached - result[picked].reached).toLocaleString('ja-JP')}人」を選択中
                    </p>
                    {canManage && <Button onClick={() => void prepareFunnelAudience()} variant="secondary">友だち一覧で見る</Button>}
                  </div>
                ) : (
                  <p className="text-ink-faint text-xs">
                    段を押すと、そこで止まっている人を選べます。
                  </p>
                )}
                {funnelAudience && (
                  <div className="bg-success-bg mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control p-3 text-xs">
                    <span className="text-success">{funnelAudience.memberCount}人を24時間の対象者として準備しました</span>
                    <Link href={`/friends?audienceId=${encodeURIComponent(funnelAudience.id)}`} className="text-accent font-medium hover:underline">対象者を開く</Link>
                  </div>
                )}
              </div>
            </section>
          )}

          {run?.runId && canManage && (
            <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
              <SaveAnalysisAction
                accountId={accountId}
                sourceKind="funnel"
                sourceResultId={run.runId}
                defaultName={selectedFunnel?.name ?? 'ファネル分析'}
              />
            </section>
          )}

          <section className="bg-canvas rounded-card border-hairline mt-3 border p-4">
            <h3 className="text-ink text-sm font-semibold">段の作り方</h3>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>・段には タグ・友だち情報・フォーム回答・サイトの行動・購入 を置けます</li>
              <li>・順番どおりに通った人だけを数えます。飛ばした人は含みません</li>
              <li>・比較条件を定義版に含めると、最大3群の通過率を同じ結果で比べられます</li>
              <li>・再集計すると新しい結果を作り、前の結果は書き換えません</li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

/**
 * ファネルの作成。
 *
 * 段は上から順に「次に進んだ人」を数える。作るときも上から並べる順で
 * 入れてもらう。番号を振らせると、抜けや重複を毎回確かめることになる。
 */
export function FunnelForm({
  accountId,
  onCancel,
  onCreated,
}: {
  accountId: string
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const KINDS = [
    { key: 'friend_add', label: '友だち追加', hint: '' },
    { key: 'tag', label: 'タグが付いた', hint: 'タグのID' },
    { key: 'field', label: '情報欄に値が入った', hint: '項目のID（値は問いません）' },
    { key: 'form', label: 'フォームに答えた', hint: 'フォームのID' },
    { key: 'site_event', label: 'サイトのページを見た', hint: 'パスのまとまり（例: thanks）' },
    { key: 'purchase', label: '購入が確定した', hint: '' },
    { key: 'link_click', label: 'リンクを踏んだ', hint: '計測リンクのID' },
    { key: 'conversion', label: '成果が記録された', hint: '成果地点のID' },
    { key: 'message', label: 'メッセージを受信した', hint: '' },
    { key: 'booking', label: '予約が確定した', hint: '' },
    { key: 'automation', label: 'オートメーションが動いた', hint: 'オートメーションのID' },
  ]

  const [name, setName] = useState('')
  // 何日以内の通過で数えるか(点検#508軽11)。裏は1〜365日を受け付ける。
  const [windowDays, setWindowDays] = useState('30')
  const [steps, setSteps] = useState([
    { label: '', kind: 'tag', value: '' },
    { label: '', kind: 'conversion', value: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const matchFor = (kind: string, value: string): Record<string, string> => {
    if (kind === 'friend_add') return {}
    if (kind === 'tag') return { tagId: value }
    if (kind === 'field') return { fieldId: value }
    if (kind === 'form') return { formId: value }
    if (kind === 'site_event') return { eventType: 'page_view', pathGroup: value }
    if (kind === 'purchase') return { status: 'confirmed' }
    if (kind === 'link_click') return { trackedLinkId: value }
    if (kind === 'conversion') return { conversionPointId: value }
    if (kind === 'message') return { direction: 'received' }
    if (kind === 'booking') return { status: 'confirmed' }
    return { automationId: value }
  }

  const kindNeedsValue = (kind: string) => !['friend_add', 'purchase', 'message', 'booking'].includes(kind)

  const save = async () => {
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (steps.some((s) => !s.label.trim())) {
      setError('すべての段に名前を付けてください')
      return
    }
    if (steps.some((s) => kindNeedsValue(s.kind) && !s.value.trim())) {
      setError('選んだ行動に必要なIDまたは値を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.analytics.v6Funnels.create(accountId, {
        name: name.trim(),
        windowDays: Number(windowDays),
        steps: steps.map((s) => ({
          label: s.label.trim(),
          kind: s.kind,
          match: matchFor(s.kind, s.value.trim()),
        })),
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      onCreated(res.data.funnelId)
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-canvas rounded-card border-hairline mb-5 space-y-4 border p-5">
      <div>
        <label htmlFor="fn-name" className="text-ink-secondary mb-1 block text-sm font-medium">
          名前
        </label>
        <input
          id="fn-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 友だち追加から購入まで"
          className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="fn-window" className="text-ink-secondary mb-1 block text-sm font-medium">
          何日以内の通過で数えるか
        </label>
        <SelectField
          id="fn-window"
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
          options={[
            { value: '7', label: '7日以内' },
            { value: '30', label: '30日以内' },
            { value: '90', label: '90日以内' },
          ]}
          className="max-w-md"
        />
      </div>

      <div className="space-y-3">
        <p className="text-ink-secondary text-sm font-medium">段（上から順に見ます）</p>
        {steps.map((step, i) => (
          <div key={i} className="border-hairline flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <span className="text-ink-faint pb-2 text-sm tabular-nums">{i + 1}.</span>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">段の名前</label>
              <input
                type="text"
                value={step.label}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, label: e.target.value } : s)),
                  )
                }
                placeholder="例: 友だち追加"
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-ink-faint mb-1 block text-xs">何をしたら</label>
              <SelectField
                value={step.kind}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, kind: e.target.value } : s)),
                  )
                }
                aria-label={`${i + 1}段目で何をしたら進むか`}
                className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                options={KINDS.map((kind) => ({ value: kind.key, label: kind.label }))}
              />
            </div>
            <div className="min-w-[10rem] flex-1">
              <label className="text-ink-faint mb-1 block text-xs">
                {KINDS.find((k) => k.key === step.kind)?.hint || '追加の指定はありません'}
              </label>
              <input
                type="text"
                value={step.value}
                disabled={!kindNeedsValue(step.kind)}
                onChange={(e) =>
                  setSteps((prev) =>
                    prev.map((s, j) => (i === j ? { ...s, value: e.target.value } : s)),
                  )
                }
                className="border-hairline rounded-control w-full border px-2 py-1.5 text-sm disabled:bg-canvas-sunken disabled:text-ink-faint"
              />
            </div>
            {steps.length > 2 && (
              <button
                onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                className="text-danger hover:bg-danger-bg rounded px-2 py-1.5 text-xs"
              >
                外す
              </button>
            )}
          </div>
        ))}
        {steps.length < 10 && (
          <button
            onClick={() => setSteps((prev) => [...prev, { label: '', kind: 'tag', value: '' }])}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-sm"
          >
            ＋ 段を足す
          </button>
        )}
      </div>

      <p className="text-ink-faint text-xs">
        段は2つ以上10個まで。1段だけだと「ただの件数」になり、どこで離れたかが分かりません。
      </p>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex gap-2">
        <Button
          onClick={save}
          disabled={saving}
          variant="primary"
        >
          {saving ? '保存中...' : '作成'}
        </Button>
        <Button
          onClick={onCancel}
        >
          キャンセル
        </Button>
      </div>
    </div>
  )
}
