'use client'

/*
 * ★V8 分析「ファネル」（Pencil `DkRDE`）。
 * 数の帯 → 選ぶ段（ファネル・何日以内・比較する条件・作る・読み直す）→ 左に全体の流れ、
 * 右に選んだ段（到達・止まった・進行中 → 対象者を開く／この対象者へ配信を作成）と比較 → 注。
 * その下に、定義の操作（期間・再集計・編集・停止・保管）・結果の保存・停止中のファネル。
 * 作る／編集のフォームと保存の欄は、入口（app/analytics/page.tsx）が今の部品を渡す。
 * 呼ぶ口・世代の守り・判定不能の扱い・CSV は今の画面（FunnelTab）と同じ。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDownRight, CalendarClock, Flag, LogIn, Plus, RefreshCw, Send, Users } from 'lucide-react'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Disclosure from '@/components/shared/disclosure'
import ListState from '@/components/shared/list-state'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { api, type AnalyticsFunnelRunResult } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { KpiMenu, RangePickerV8, StatePill } from './common'
import { downloadCsv, formatAnalyticsDate, formatAnalyticsDateTime, rangeFor, useRegisterExport } from './parts'
import styles from './analytics.module.css'

type FunnelStatus = 'active' | 'stopped' | 'archived'
type FunnelSummary = { id: string; name: string; windowDays: number; createdAt: string; status: FunnelStatus; currentVersion: { id: string; versionNumber: number; createdAt: string } | null; migrationState: 'ready' | 'needs_migration' }
export type FunnelEditDraft = {
  funnelId: string
  name: string
  windowDays: string
  steps: Array<{ label: string; kind: string; value: string; match: Record<string, string> }>
  segment: unknown
  comparisonGroups: unknown[]
  expectedVersionNumber: number
}
export type FunnelFormSlot = (props: {
  edit?: FunnelEditDraft
  presetConversion: { id: string; name: string } | null
  onCancel: () => void
  onCreated: (id: string, usageWarnings?: string[]) => void
}) => ReactNode
export type FunnelSaveSlot = (props: { sourceResultId: string; defaultName: string }) => ReactNode

const STATE_LABELS: Record<AnalyticsFunnelRunResult['state'], string> = { available: '利用可能', partial: '一部集計', unavailable: '未取得', failed: '失敗' }

// 実行間隔ガードなどの符号を運用の言葉に言い換える（今の画面と同じ）。
function explainStartError(code: string, fallback: string): string {
  if (code === 'analytics_cross_busy') return '他の集計が動いています。終わってからもう一度押してください'
  if (code === 'analytics_funnel_too_soon') return 'さきほど集計したばかりです。少し待ってから押してください'
  if (code === 'analytics_funnel_not_active') return '停止中・保管したファネルでは再集計や対象者づくりはできません'
  if (code === 'analytics_funnel_version_conflict' || code === 'analytics_funnel_status_conflict') return '他の人が先に変更しています。最新の状態を開き直してください'
  if (code === 'analytics_funnel_invalid_transition') return 'その状態へは進めません'
  return fallback
}
// 保存済みの段の条件（match）を、編集フォームの1入力へ戻す。
function funnelStepFormValue(kind: string, match: Record<string, string>): string {
  switch (kind) {
    case 'tag': return match.tagId ?? ''
    case 'field': return match.fieldId ?? ''
    case 'form': return match.formId ?? ''
    case 'site_event': return match.pathGroup ?? ''
    case 'link_click': return match.trackedLinkId ?? ''
    case 'conversion': return match.conversionPointId ?? ''
    case 'automation': return match.automationId ?? ''
    default: return ''
  }
}
// 「7日」は6日前の0時から、実行時点まで（Worker は締切より未来の終了を拒否する）。
function funnelCohortRange(days: number, now = new Date()) {
  const range = rangeFor(days - 1, now)
  return { cohortFrom: `${range.from}T00:00:00.000+09:00`, cohortTo: now.toISOString() }
}
const circled = (n: number) => '①②③④⑤⑥⑦⑧⑨⑩'[n - 1] ?? String(n)

export default function FunnelV8({ accountId, canManage, presetConversion, renderForm, renderSave, stepKindsLabel }: {
  accountId: string
  canManage: boolean
  presetConversion?: { id: string; name: string } | null
  renderForm?: FunnelFormSlot
  renderSave?: FunnelSaveSlot
  /** 段に置ける種類（入口が正本の一覧から渡す）。 */
  stepKindsLabel?: string
}) {
  const router = useRouter()
  const [funnels, setFunnels] = useState<FunnelSummary[]>([])
  const [selected, setSelected] = useState('')
  const [run, setRun] = useState<AnalyticsFunnelRunResult | null>(null)
  const [groupKey, setGroupKey] = useState('all')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [noRun, setNoRun] = useState(false)
  const [listError, setListError] = useState('')
  const [funnelsReload, setFunnelsReload] = useState(0)
  const [runReload, setRunReload] = useState(0)
  const [creating, setCreating] = useState(false)
  useEffect(() => { if (presetConversion?.id && canManage) setCreating(true) }, [presetConversion?.id, canManage])
  const [picked, setPicked] = useState<number | null>(null)
  const [usageNotice, setUsageNotice] = useState('')
  const [funnelDays, setFunnelDays] = useState(30)
  const [audienceSelection, setAudienceSelection] = useState<'reached' | 'stopped' | 'in_progress'>('stopped')
  const [audienceBusy, setAudienceBusy] = useState(false)
  // アカウント・ファネル・期間を切り替えた瞬間に世代を進め、古い応答を出さない。
  const viewGeneration = useRef(0)
  const scope = `${accountId}:${selected}:${funnelDays}`
  const scopeRef = useRef(scope)
  if (scopeRef.current !== scope) { scopeRef.current = scope; viewGeneration.current += 1 }

  useEffect(() => {
    let active = true
    setLoading(true); setListError(''); setFunnels([]); setSelected(''); setRun(null); setGroupKey('all'); setPicked(null)
    void api.analytics.v6Funnels.list(accountId, { includeInactive: true }).then((res) => {
      if (!active) return
      if (res.success) {
        setFunnels(res.data)
        // 停止・保管したものは選ばせない。最初の利用可能なファネルを開く。
        const firstActive = res.data.find((f) => f.status === 'active')
        if (firstActive) setSelected(firstActive.id)
      } else setListError(res.error || 'ファネルを読み込めませんでした')
    }).catch(() => { if (active) setListError('ファネルを読み込めませんでした') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accountId, funnelsReload])

  useEffect(() => {
    if (!selected) return
    let active = true
    setPicked(null); setRun(null); setRunError(''); setNoRun(false); setRunning(false)
    void api.analytics.v6Funnels.latestRun(accountId, selected).then((res) => {
      if (!active) return
      if (res.success) { setRun(res.data); setGroupKey(res.data.groups[0]?.key ?? 'all') }
      else if (res.error === 'Not found') setNoRun(true)
      else setRunError(res.error)
    })
    return () => { active = false }
  }, [accountId, selected, runReload])
  useEffect(() => { setRunning(false) }, [accountId, selected, funnelDays])

  const runNow = async () => {
    if (!selected) return
    const generation = viewGeneration.current
    setRunning(true); setRunError('')
    try {
      const response = await api.analytics.v6Funnels.run(accountId, selected, funnelCohortRange(funnelDays))
      if (!response.success) throw new Error(response.error)
      if (generation !== viewGeneration.current) return
      setRun(response.data); setGroupKey(response.data.groups[0]?.key ?? 'all')
    } catch (error) {
      if (generation !== viewGeneration.current) return
      const code = error instanceof Error ? error.message : ''
      setRunError(explainStartError(code, code || '再集計できませんでした'))
    } finally {
      if (generation === viewGeneration.current) setRunning(false)
    }
  }
  const reloadFunnels = async (pickId?: string) => {
    const res = await api.analytics.v6Funnels.list(accountId, { includeInactive: true })
    if (!res.success) return
    setFunnels(res.data)
    if (pickId !== undefined) { setSelected(pickId); return }
    setSelected((prev) => {
      const still = res.data.find((f) => f.id === prev)
      if (still && still.status === 'active') return prev
      return res.data.find((f) => f.status === 'active')?.id ?? ''
    })
  }

  // 定義の編集は「現在版を下書きへ読み、新版として保存」。過去の版と結果は変えない。
  const [editTarget, setEditTarget] = useState<FunnelEditDraft | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const startEdit = async () => {
    if (!selected) return
    setEditLoading(true); setRunError('')
    try {
      const res = await api.analytics.v6Funnels.get(accountId, selected)
      if (!res.success) { setRunError(res.error || '定義を読み込めませんでした'); return }
      if (!res.data.currentVersion) { setRunError('このファネルは旧形式のため編集できません。新しい段を組んで作り直してください'); return }
      const version = res.data.currentVersion
      setEditTarget({
        funnelId: res.data.id, name: res.data.name, windowDays: String(version.windowDays),
        steps: version.steps.map((step) => ({ label: step.label, kind: step.kind, value: funnelStepFormValue(step.kind, step.match), match: step.match })),
        segment: version.segment, comparisonGroups: version.comparisonGroups, expectedVersionNumber: version.versionNumber,
      })
    } catch { setRunError('定義を読み込めませんでした') } finally { setEditLoading(false) }
  }

  // 停止は再開できる。保管は終端で、一覧と再集計から外れて戻せない。
  const [statusTarget, setStatusTarget] = useState<{ funnel: { id: string; name: string; status: FunnelStatus }; to: FunnelStatus } | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const applyStatusChange = async () => {
    if (!statusTarget || statusBusy) return
    setStatusBusy(true); setRunError('')
    try {
      const res = await api.analytics.v6Funnels.setStatus(accountId, statusTarget.funnel.id, { status: statusTarget.to, expectedStatus: statusTarget.funnel.status })
      if (!res.success) { setRunError(explainStartError(res.error, '状態を変えられませんでした')); return }
      setStatusTarget(null)
      await reloadFunnels()
    } catch { setRunError('状態を変えられませんでした') } finally { setStatusBusy(false) }
  }

  const activeGroup = run?.groups.find((group) => group.key === groupKey) ?? run?.groups[0] ?? null
  const result = activeGroup?.steps ?? null
  // 未取得・失敗の結果では人数を出さない（「離脱100%」のような結論に読めるため）。
  const measurable = !!run && (run.state === 'available' || run.state === 'partial')
  // いちばん落ちる段：人数の差ではなく、落ちた割合で選ぶ。途中の人は「落ちた」に入れない。
  const worst = useMemo(() => {
    if (!measurable || !result || result.length < 2) return null
    let found: { index: number; lost: number; rate: number } | null = null
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]
      if (prev.reached === 0) continue
      const rate = prev.droppedAfter / prev.reached
      if (!found || rate > found.rate) found = { index: i, lost: prev.droppedAfter, rate }
    }
    return found
  }, [measurable, result])
  // 段を選んでいないときは、いちばん落ちる手前の段（そこで止まった人）を選んだ形で見せる。
  const shownPick = picked ?? (worst ? worst.index - 1 : null)
  const overall = useMemo(() => {
    if (!measurable || !result || result.length === 0) return null
    const first = result[0]
    const last = result[result.length - 1]
    return { entry: first.reached, entryLabel: first.label, last: last.reached, rate: first.reached > 0 ? Math.round((last.reached / first.reached) * 1000) / 10 : null }
  }, [measurable, result])
  const comparisonGap = useMemo(() => {
    if (!measurable || !run || run.groups.length < 2) return null
    let largest = 0
    for (let index = 0; index < run.groups[0].steps.length; index += 1) {
      const rates = run.groups.map((group) => group.steps[index]?.conversionFromPrevious).filter((value): value is number => value !== null && value !== undefined)
      if (rates.length < 2) continue
      largest = Math.max(largest, Math.max(...rates) - Math.min(...rates))
    }
    return Math.round(largest * 1000) / 10
  }, [measurable, run])

  const selectedFunnel = funnels.find((f) => f.id === selected) ?? null
  const inactiveFunnels = funnels.filter((f) => f.status !== 'active')
  const exportFunnel = () => {
    if (!result) return
    downloadCsv('analytics-funnel.csv', [
      ...(run && run.state !== 'available' ? [['集計状態', `${STATE_LABELS[run.state]}${run.stateReason ? `（${run.stateReason}）` : ''}`]] : []),
      ...(run?.versionNumber != null ? [['集計した定義版', `${run.versionNumber}`]] : []),
      ['段', '到達した人', '前の段からの通過率', 'ここで止まった人', 'まだ途中の人'],
      ...result.map((step) => measurable ? [step.label, step.reached, step.conversionFromPrevious === null ? null : `${Math.round(step.conversionFromPrevious * 1000) / 10}%`, step.droppedAfter, step.inProgressAfter] : [step.label, null, null, null, null]),
    ])
  }
  useRegisterExport(exportFunnel, !result)

  /** 選んだ段の対象者を24時間の対象者として作り、その先（友だち一覧・配信）へ進む。 */
  const openAudience = async (to: 'friends' | 'broadcast') => {
    if (!run?.runId || shownPick === null || !result?.[shownPick] || !activeGroup || selectedFunnel?.status !== 'active') return
    const generation = viewGeneration.current
    setRunError(''); setAudienceBusy(true)
    try {
      const response = await api.analytics.createResultAudience(accountId, run.runId, { sourceKind: 'funnel', groupKey: activeGroup.key, stepOrder: result[shownPick].stepOrder, selection: audienceSelection })
      if (!response.success) throw new Error(response.error)
      if (generation !== viewGeneration.current) return
      const id = encodeURIComponent(response.data.id)
      router.push(to === 'friends' ? `/friends?audienceId=${id}` : `/broadcasts/new?audienceId=${id}`)
    } catch (error) {
      if (generation !== viewGeneration.current) return
      setRunError(explainStartError(error instanceof Error ? error.message : '', '対象者を準備できませんでした'))
    } finally { setAudienceBusy(false) }
  }

  if (loading) return <div className={styles.body} data-gap="tab"><ListState kind="loading" title="ファネルを読み込んでいます" /></div>

  const pickedStep = shownPick !== null && result ? result[shownPick] ?? null : null
  const nextStep = shownPick !== null && result ? result[shownPick + 1] ?? null : null
  const audienceCount = pickedStep ? (audienceSelection === 'stopped' ? pickedStep.droppedAfter : audienceSelection === 'reached' ? pickedStep.reached : pickedStep.inProgressAfter) : 0
  const audienceTitle = audienceSelection === 'stopped' ? 'この段で止まった人' : audienceSelection === 'reached' ? 'この段に到達した人' : 'この段で進行中の人'
  const audienceNote = pickedStep ? (audienceSelection === 'stopped'
    ? `${pickedStep.label}まで進んだが、${selectedFunnel?.windowDays ?? ''}日以内に${nextStep ? `「${nextStep.label}」へ` : '次へ'}進んでいない人です。`
    : audienceSelection === 'reached' ? `順番どおりに「${pickedStep.label}」まで通った人です。` : `「${pickedStep.label}」まで進み、まだ判定の期間中の人です。`) : ''
  const top = measurable ? (result?.[0]?.reached ?? 0) : 0
  const menu = (title: string) => <KpiMenu title={title} onExport={exportFunnel} disabled={!result} />
  const showForm = creating || editTarget

  return <>
    {!showForm && funnels.length > 0 ? <KpiBand className={styles.band}>
      <KpiCard presentation="band" title="入口" icon={<LogIn size={13} aria-hidden="true" />} menu={menu('入口')} value={overall?.entry ?? null} unit="人" detail={measurable ? (overall?.entryLabel ?? '—') : run ? '判定不能' : '—'} />
      <KpiCard presentation="band" title="最後まで" icon={<Flag size={13} aria-hidden="true" />} menu={menu('最後まで')} value={overall?.last ?? null} unit="人" detail={measurable ? (overall?.rate != null ? `入口の ${overall.rate}%` : '—') : run ? '判定不能' : '—'} />
      <KpiCard presentation="band" title="いちばん落ちる段" icon={<ArrowDownRight size={13} aria-hidden="true" />} menu={menu('いちばん落ちる段')} value={worst ? Math.round(worst.rate * 100) : null} valueText={worst ? `−${Math.round(worst.rate * 100)}` : undefined} unit="%" detail={worst && result ? `${result[worst.index - 1].label} → ${result[worst.index].label}` : run && !measurable ? '判定不能' : '—'} />
      {/* 段ごとの到達日時を持っていない（集計は「通ったか」だけを見る）。 */}
      <KpiCard presentation="band" title="平均の到達日数" icon={<CalendarClock size={13} aria-hidden="true" />} menu={menu('平均の到達日数')} value={null} unit="日" detail="到達日時が無く未取得" />
    </KpiBand> : null}
    <div className={styles.body} data-gap="tab">
      {showForm && renderForm ? renderForm({
        edit: editTarget ?? undefined,
        presetConversion: editTarget ? null : (presetConversion ?? null),
        onCancel: () => { setCreating(false); setEditTarget(null) },
        onCreated: (id, usageWarnings) => {
          setCreating(false); setEditTarget(null)
          setUsageNotice(usageWarnings && usageWarnings.length > 0 ? `作成はできましたが、成果地点への利用先記録に失敗しました：${usageWarnings.join('、')}。成果地点側の利用先一覧には出ていません。` : '')
          void reloadFunnels(id)
        },
      }) : listError ? <ListState kind="error" title="ファネルを読み込めませんでした。" description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。" onRetry={() => setFunnelsReload((n) => n + 1)} />
        : funnels.length === 0 ? <ListState kind="empty" title="ファネルがまだありません" description={canManage ? '段を2つ以上つないで、どこで離れているかを見られます。' : '段を2つ以上つないで、どこで離れているかを見られます。作成は統括・管理者へ依頼してください。'} action={canManage ? <Button variant="secondary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />ファネルを作る</Button> : undefined} />
        : <>
          <div className={styles.controls}>
            <label className={styles.field} data-w="funnel"><span className={styles.fieldLabel}>ファネル</span>
              <Select id="funnel-select" value={selected} onChange={(value) => setSelected(value)} aria-label="ファネル" size="full" options={funnels.some((f) => f.status === 'active' || f.id === selected)
                ? funnels.filter((f) => f.status === 'active' || f.id === selected).map((f) => ({ value: f.id, label: f.status === 'active' ? f.name : `${f.name}（${f.status === 'stopped' ? '停止中' : '保管済み'}）` }))
                : [{ value: '', label: '使えるファネルがありません' }]} />
            </label>
            <label className={styles.field} data-w="window"><span className={styles.fieldLabel}>何日以内の通過で数えるか</span>
              <Select aria-label="何日以内の通過で数えるか" disabled size="full" onChange={() => {}} value={String(selectedFunnel?.windowDays ?? '')} options={[{ value: String(selectedFunnel?.windowDays ?? ''), label: selectedFunnel ? `${selectedFunnel.windowDays}日以内` : '未取得' }]} />
            </label>
            {run ? <label className={styles.field} data-w="group"><span className={styles.fieldLabel}>比較する条件</span>
              <Select id="funnel-group" value={groupKey} onChange={(value) => { setGroupKey(value); setPicked(null) }} aria-label="比較する条件" size="full" options={run.groups.map((group) => ({ value: group.key, label: `${group.label}（入口 ${formatNumber(group.entrants)}人）` }))} />
            </label> : null}
            <span className={styles.spacer} />
            {canManage ? <Button variant="secondary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />ファネルを作る</Button> : null}
            <Button variant="secondary" disabled={running} onClick={() => setRunReload((n) => n + 1)}><RefreshCw size={15} aria-hidden="true" />最新の結果をもう一度読む</Button>
          </div>
          {runError ? <p className={styles.inlineError} role="alert">{runError}</p> : null}
          {noRun && !run ? <p className={styles.caption}>{`まだ集計がありません。下の「定義の操作と集計の詳細」から「この${funnelDays}日を再集計」を押してください`}</p> : null}
          {usageNotice ? <p className={styles.warnText} role="status">{usageNotice}</p> : null}
          {run && !measurable ? <p className={styles.warnText} role="status">{`${STATE_LABELS[run.state]}のため、この結果は判定不能です。人数や割合は実測値ではありません。${run.stateReason ? ` ${run.stateReason}` : ''}`}</p> : null}
          {run && run.state === 'partial' ? <p className={styles.warnText}>{run.stateReason ?? '一部の期間・種類のデータが無いため、実際より少なく数えている可能性があります。'}</p> : null}
          {/* 結果は集計時の版の写し。いまの定義とずれていたら断り、再集計へ誘導する。 */}
          {run && selectedFunnel?.currentVersion && run.versionNumber != null && run.versionNumber !== selectedFunnel.currentVersion.versionNumber
            ? <p className={styles.warnText} role="status">{`この結果は定義版${run.versionNumber}で集計したものです。いまの定義は版${selectedFunnel.currentVersion.versionNumber}です。「この${funnelDays}日を再集計」で、いまの定義の結果に更新できます。`}</p> : null}

          {result ? <div className={styles.routesSplit}>
            <section className={styles.funnelFlow} aria-labelledby="funnel-flow-title">
              <h2 id="funnel-flow-title" className={styles.hoursTitle}>全体の流れ</h2>
              <p className={styles.caption}>順番どおりに通った人だけを数えます。飛ばした人は含みません。</p>
              {result.map((step, i) => {
                const previous = i > 0 ? result[i - 1] : null
                const dropRate = previous && previous.reached > 0 ? previous.droppedAfter / previous.reached * 100 : null
                return <button key={step.stepOrder} type="button" className={styles.funnelStep} data-selected={shownPick === i || undefined} disabled={!measurable} onClick={() => setPicked(i)} aria-pressed={shownPick === i} title={previous ? `止まった ${previous.droppedAfter}人・進行中 ${previous.inProgressAfter}人` : undefined}>
                  <span className={styles.funnelNumber}>{i + 1}</span>
                  <span className={styles.funnelLabel} title={step.label}>{step.label}</span>
                  <span className={styles.funnelTrack} aria-hidden="true"><span style={{ width: top > 0 && measurable ? `${step.reached / top * 100}%` : '0%' }} /></span>
                  <span className={styles.funnelValue}>{measurable ? `${formatNumber(step.reached)} 人` : '—'}</span>
                  <span className={styles.funnelDrop} data-tone={measurable && dropRate !== null ? 'warn' : undefined}>{measurable && dropRate !== null ? `−${dropRate.toFixed(0)}%` : '—'}</span>
                </button>
              })}
            </section>
            <aside className={styles.funnelSide} aria-labelledby="funnel-picked-title">
              <h2 id="funnel-picked-title" className={styles.hoursTitle}>{pickedStep ? `${circled(shownPick! + 1)} ${pickedStep.label}（選んだ段）` : '段を選んで対象者を確認'}</h2>
              {pickedStep && measurable ? (selectedFunnel?.status === 'active' ? <>
                <SegmentedControl aria-label="対象者の種類" value={audienceSelection} onChange={setAudienceSelection} options={[{ value: 'reached', label: '到達した人' }, { value: 'stopped', label: '止まった人' }, { value: 'in_progress', label: '進行中の人' }]} />
                <p className={styles.audienceCount}>{`${audienceTitle} ${formatNumber(audienceCount)} 人`}</p>
                <p className={styles.caption}>{audienceNote}</p>
                {canManage ? <>
                  <span><Button variant="secondary" disabled={audienceBusy || audienceCount === 0} onClick={() => void openAudience('friends')}><Users size={15} aria-hidden="true" />対象者を開く</Button></span>
                  <span><Button variant="secondary" disabled={audienceBusy || audienceCount === 0} onClick={() => void openAudience('broadcast')}><Send size={15} aria-hidden="true" />この対象者へ配信を作成</Button></span>
                </> : <p className={styles.caption}>対象者づくりは統括・管理者が行えます。</p>}
              </> : <p className={styles.caption}>停止中・保管したファネルでは対象者づくりはできません。結果の確認だけができます。</p>)
                : <p className={styles.caption}>{run && !measurable ? 'この結果は判定不能のため、対象者は選べません。' : '段を押すと、到達・停止・進行中の人を選べます。'}</p>}
              {run && run.groups.length > 1 ? <>
                <h3 className={styles.compareTitle}>比較</h3>
                {run.groups.map((group) => {
                  const rate = measurable && group.entrants > 0 ? group.completed / group.entrants * 100 : null
                  const lowest = measurable && run.groups.every((other) => other.entrants === 0 || other.completed / other.entrants * 100 >= (rate ?? 0))
                  return <div key={group.key} className={styles.compareRow}><span className={styles.flowLabel} data-size="row">{group.label}</span><span className={styles.spacer} /><strong data-tone={lowest && run.groups.length > 1 ? 'warn' : undefined}>{`通過率 ${rate === null ? '—' : `${Math.round(rate)}%`}`}</strong></div>
                })}
                <p className={styles.caption}>{`比較で差が大きい段 ${comparisonGap === null ? '—' : `${comparisonGap}pt`}`}</p>
              </> : null}
            </aside>
          </div> : null}
          <p className={styles.noteBox}>再集計すると新しい結果を作り、前の結果は書き換えません。比較条件を定義版に含めると、最大3群の通過率を同じ結果で比べられます。停止中・保管したファネルは「ファネル」の選ぶ欄の下から開けます。</p>
          {run ? <p className={styles.caption}>{`集計期間 ${formatAnalyticsDate(run.cohortFrom)}〜${formatAnalyticsDate(run.cohortTo)} ／ データ締切 ${formatAnalyticsDateTime(run.dataCutoffAt)}${run.versionNumber != null ? ` ／ 集計した定義版 ${run.versionNumber}` : ''}`}</p> : null}
          <Disclosure title="定義の操作と集計の詳細" size="compact">
            <div className={styles.toolbar}>
              <RangePickerV8 days={funnelDays} onChange={(days) => { setFunnelDays(days); setPicked(null); setRunning(false) }} />
              <Button onClick={() => void runNow()} disabled={running || selectedFunnel?.status !== 'active'} variant="secondary" busy={running} busyLabel="再集計中">{`この${funnelDays}日を再集計`}</Button>
            </div>
            {selectedFunnel ? <p className={styles.caption}>{`${selectedFunnel.windowDays}日以内に通った人を数えます。${selectedFunnel.currentVersion ? ` 定義版 ${selectedFunnel.currentVersion.versionNumber}` : ' 現行定義の移行が必要です'}${selectedFunnel.status === 'stopped' ? ' 停止中です。再集計や対象者づくりはできません。' : ''}${selectedFunnel.status === 'archived' ? ' 保管済みです。過去の結果だけを見られます。' : ''}`}</p> : null}
            {canManage && selectedFunnel ? <div className={styles.rowActions} data-gap="wide">
              {selectedFunnel.status === 'active' ? <>
                <Button onClick={() => void startEdit()} disabled={editLoading || !selectedFunnel.currentVersion} variant="secondary" busy={editLoading} busyLabel="定義を読み込み中">定義を編集</Button>
                <Button onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'stopped' })} variant="secondary">停止</Button>
                <Button onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'archived' })} variant="secondary">保管</Button>
              </> : null}
              {selectedFunnel.status === 'stopped' ? <>
                <Button onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'active' })} variant="secondary">再開</Button>
                <Button onClick={() => setStatusTarget({ funnel: selectedFunnel, to: 'archived' })} variant="secondary">保管</Button>
              </> : null}
            </div> : null}
          </Disclosure>
          {run?.runId && canManage && renderSave ? <Disclosure title="この結果を保存する" size="compact">{renderSave({ sourceResultId: run.runId, defaultName: selectedFunnel?.name ?? 'ファネル分析' })}</Disclosure> : null}
          <Disclosure title="段の作り方" size="compact">
            <ul className={styles.plainList}>
              {stepKindsLabel ? <li>{`・段には ${stepKindsLabel} を置けます`}</li> : null}
              <li>・順番どおりに通った人だけを数えます。飛ばした人は含みません</li>
              <li>・比較条件を定義版に含めると、最大3群の通過率を同じ結果で比べられます</li>
              <li>・再集計すると新しい結果を作り、前の結果は書き換えません</li>
              <li>・同じ人が同じ段を2回通っても1回として数えます。まだ途中の人は完了した人に含めません</li>
            </ul>
          </Disclosure>
          {inactiveFunnels.length > 0 ? <section className={styles.flowCard} data-w="full" aria-labelledby="funnel-inactive-title">
            <h2 id="funnel-inactive-title" className={styles.hoursTitle}>停止中・保管したファネル</h2>
            <p className={styles.caption}>停止中は再集計と対象者づくりを止めています。保管したものは戻せません。過去の結果は残っています。</p>
            {inactiveFunnels.map((funnel) => <div key={funnel.id} className={styles.compareRow}>
              <span className={styles.cellStrong}>{funnel.name}</span>
              <StatePill tone={funnel.status === 'stopped' ? 'warn' : 'neutral'}>{funnel.status === 'stopped' ? '停止中' : '保管済み'}</StatePill>
              <button type="button" className={styles.linkButton} onClick={() => setSelected(funnel.id)}>結果を見る</button>
              {canManage && funnel.status === 'stopped' ? <>
                <Button onClick={() => setStatusTarget({ funnel, to: 'active' })} variant="secondary">再開</Button>
                <Button onClick={() => setStatusTarget({ funnel, to: 'archived' })} variant="secondary">保管</Button>
              </> : null}
              {funnel.status === 'archived' ? <span className={styles.caption}>戻せません</span> : null}
            </div>)}
          </section> : null}
        </>}
    </div>
    <ConfirmDialog
      open={statusTarget !== null}
      title={statusTarget?.to === 'stopped' ? 'ファネルを停止しますか' : statusTarget?.to === 'archived' ? 'ファネルを保管しますか' : 'ファネルを再開しますか'}
      description={statusTarget?.to === 'stopped' ? `「${statusTarget.funnel.name}」の再集計と対象者づくりを止めます。過去の結果は残り、あとから再開できます。`
        : statusTarget?.to === 'archived' ? `「${statusTarget.funnel.name}」を保管すると一覧から外れ、あとから戻せません。過去の結果は残ります。`
        : statusTarget ? `「${statusTarget.funnel.name}」を再開します。再集計と対象者づくりがまた使えます。` : ''}
      confirmLabel={statusTarget?.to === 'stopped' ? '停止する' : statusTarget?.to === 'archived' ? '保管する' : '再開する'}
      destructive={statusTarget?.to === 'archived'}
      busy={statusBusy}
      onConfirm={() => void applyStatusChange()}
      onCancel={() => setStatusTarget(null)}
    />
  </>
}
