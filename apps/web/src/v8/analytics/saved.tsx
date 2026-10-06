'use client'

/*
 * ★V8 分析「保存した分析」（Pencil `bglah`）。
 * 数の帯 → 道具の段（探す・説明）→ 左に保存した分析の表、右に選んだ分析の履歴（結果を見る・CSV・内容を変える）
 * → 定期レポート（作る・止める・また送る・しまう）→ 1回だけ送った結果。
 * 呼ぶ口・世代の守り・失敗の言い分け・CSV は今の画面（SavedAnalyticsTab）と同じ。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bookmark, Download, FilePen, History, Mail, Plus } from 'lucide-react'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import { api, type AnalyticsReportRun, type AnalyticsReportSchedule, type RecentOneTimeReport, type SavedAnalyticsSnapshot, type SavedAnalyticsSummary } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { KpiMenu, StatePill, shortDateTime, shortDay } from './common'
import { downloadCsv, formatAnalyticsDate, formatAnalyticsDateTime, useRegisterExport } from './parts'
import styles from './analytics.module.css'

const SAVED_STATE_LABELS: Record<SavedAnalyticsSnapshot['state'], string> = { available: '利用可能', partial: '一部集計', unavailable: '未取得', failed: '失敗' }
const REPORT_STATUS_LABELS: Record<AnalyticsReportSchedule['status'], string> = { active: '動いている', paused: '止めている', archived: 'しまった' }
const RUN_STATE_LABELS: Record<AnalyticsReportRun['state'], string> = { running: '送信中', available: '送信済み', partial: '一部だけ送信', unavailable: '未取得', failed: '失敗' }

function runErrorLabel(errorCode: string | null, state: AnalyticsReportRun['state']): string | null {
  if (state !== 'failed') return null
  if (errorCode === 'worker_interrupted') return '送信の途中で止まりました（送達不明）。届いたか分からない宛先へは送り直さず、確認してから判断してください。'
  if (errorCode === 'schedule_changed_before_send') return '送る直前に内容が変わったため、旧設定では送りませんでした。'
  return errorCode ? `送れませんでした（${errorCode}）。宛先別の結果を確かめてください。` : '送れませんでした。宛先別の結果を確かめてください。'
}
const cadenceLabel = (schedule: AnalyticsReportSchedule) => schedule.cadence === 'weekly'
  ? `毎週 ${'日月火水木金土'[schedule.weekday ?? 0]} ${schedule.sendTime}`
  : `毎月 ${schedule.monthDay}日 ${schedule.sendTime}`
const kindLabel = (kind: 'cross' | 'funnel') => kind === 'cross' ? 'クロス分析' : 'ファネル'
const periodShort = (from: string, to: string) => `${shortDay(from)}〜${shortDay(to)}`

/** 保存した時点の結果の葉の値を並べる（0 は「0件」、欠けは「未取得」）。今の画面と同じ。 */
function summarizeSnapshotResult(result: unknown, limit = 12): Array<{ path: string; text: string }> {
  const rows: Array<{ path: string; text: string }> = []
  const visit = (node: unknown, path: string, depth: number) => {
    if (rows.length >= limit || depth > 3) return
    if (node === null || node === undefined) { rows.push({ path, text: '未取得' }); return }
    if (typeof node === 'number' || typeof node === 'string' || typeof node === 'boolean') { rows.push({ path, text: typeof node === 'number' ? formatNumber(node) : String(node) }); return }
    if (Array.isArray(node)) {
      if (node.length === 0) rows.push({ path, text: '0件' })
      node.slice(0, 4).forEach((item, index) => visit(item, `${path}[${index + 1}]`, depth + 1))
      if (node.length > 4) rows.push({ path, text: `ほか${node.length - 4}件` })
      return
    }
    if (typeof node === 'object') {
      const entries = Object.entries(node)
      if (entries.length === 0) rows.push({ path, text: '—' })
      entries.slice(0, 8).forEach(([key, child]) => visit(child, path ? `${path}・${key}` : key, depth + 1))
    }
  }
  visit(result, '', 0)
  return rows.filter((row) => row.path !== '' || row.text !== '—')
}

function latestPill(item: SavedAnalyticsSummary) {
  const latest = item.latestSnapshot
  if (!latest) return <span className={styles.faint}>—</span>
  // 版ずれ（定義が古い）は集計状態とは別の軸。版ずれを先に出す。
  if (latest.definitionStale) return <StatePill tone="info">更新後未集計</StatePill>
  if (latest.state === 'available') return <StatePill tone="ok">最新の期間</StatePill>
  return <StatePill tone={latest.state === 'partial' ? 'warn' : 'neutral'}>{SAVED_STATE_LABELS[latest.state]}</StatePill>
}

export default function SavedV8({ accountId, onCountChange, canManage }: { accountId: string; onCountChange?: (count: number | null) => void; canManage: boolean }) {
  const [items, setItems] = useState<SavedAnalyticsSummary[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [snapshots, setSnapshots] = useState<SavedAnalyticsSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [error, setError] = useState('')
  const [schedules, setSchedules] = useState<AnalyticsReportSchedule[]>([])
  const [recentOneTime, setRecentOneTime] = useState<RecentOneTimeReport[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [schedulesError, setSchedulesError] = useState('')
  const [scheduleBusyId, setScheduleBusyId] = useState('')
  const [snapshotError, setSnapshotError] = useState('')
  const [savedReload, setSavedReload] = useState(0)
  const [snapshotReload, setSnapshotReload] = useState(0)
  const [archiveTarget, setArchiveTarget] = useState<AnalyticsReportSchedule | null>(null)
  const [openSnapshot, setOpenSnapshot] = useState<SavedAnalyticsSnapshot | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true); setItems([]); setSelectedId(''); setSnapshots([]); setError('')
    void api.analytics.saved.list(accountId).then((response) => {
      if (!active) return
      if (!response.success) throw new Error(response.error)
      setItems(response.data)
      setSelectedId(response.data[0]?.id ?? '')
      // 件数表示はこの取得結果を使い回す。タブ名のためだけにもう1回叩かない。
      onCountChange?.(response.data.length)
    }).catch((caught: unknown) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : '保存した分析を確認できませんでした')
      onCountChange?.(null)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, savedReload])

  const schedulesAlive = useRef(true)
  useEffect(() => () => { schedulesAlive.current = false }, [])
  // 再読込の応答も「どのアカウントへ向けた取得か」の世代で比べる（切替後の遅い旧応答を捨てる）。
  const schedulesGen = useRef(0)
  const scheduleErrorText = (caught: unknown) => caught instanceof TypeError ? '定期レポートを確認できませんでした' : caught instanceof Error ? caught.message : '定期レポートを確認できませんでした'
  const reloadSchedules = useCallback(() => {
    const gen = (schedulesGen.current += 1)
    setSchedulesLoading(true)
    void api.analytics.reportSchedules.list(accountId).then((response) => {
      if (!schedulesAlive.current || gen !== schedulesGen.current) return
      if (!response.success) throw new Error(response.error)
      setSchedules(response.data.items)
      setRecentOneTime(response.data.recentOneTime ?? [])
    }).catch((caught: unknown) => {
      if (!schedulesAlive.current || gen !== schedulesGen.current) return
      setSchedulesError(scheduleErrorText(caught))
    }).finally(() => { if (schedulesAlive.current && gen === schedulesGen.current) setSchedulesLoading(false) })
  }, [accountId])
  useEffect(() => {
    let active = true
    schedulesGen.current += 1
    setSchedulesLoading(true); setSchedules([]); setRecentOneTime([]); setSchedulesError('')
    // アカウントが変わったら前の確認窓は閉じる（別アカウントへ操作を送らない）。
    setArchiveTarget(null)
    void api.analytics.reportSchedules.list(accountId).then((response) => {
      if (!active) return
      if (!response.success) throw new Error(response.error)
      setSchedules(response.data.items)
      setRecentOneTime(response.data.recentOneTime ?? [])
    }).catch((caught: unknown) => { if (active) setSchedulesError(scheduleErrorText(caught)) })
      .finally(() => { if (active) setSchedulesLoading(false) })
    return () => { active = false }
  }, [accountId])

  const changeScheduleStatus = async (schedule: AnalyticsReportSchedule, status: 'active' | 'paused' | 'archived') => {
    setScheduleBusyId(schedule.id)
    setSchedulesError('')
    try {
      const response = await api.analytics.reportSchedules.setStatus(accountId, schedule.id, { status, expectedUpdatedAt: schedule.updatedAt })
      if (!response.success) {
        // 先に誰かが変えていたら最新を読み直してから知らせる。
        setSchedulesError(response.error)
        reloadSchedules()
        return
      }
      setSchedules((current) => status === 'archived' ? current.filter((item) => item.id !== schedule.id) : current.map((item) => (item.id === schedule.id ? response.data : item)))
      setArchiveTarget(null)
    } catch (caught) {
      setSchedulesError(caught instanceof Error ? caught.message : '定期レポートを更新できませんでした')
    } finally {
      setScheduleBusyId('')
    }
  }

  useEffect(() => {
    if (!selectedId) { setSnapshots([]); setSnapshotError(''); return }
    let active = true
    setSnapshotLoading(true); setSnapshots([]); setSnapshotError('')
    void api.analytics.saved.snapshots(accountId, selectedId).then((response) => {
      if (!active) return
      if (!response.success) throw new Error(response.error)
      setSnapshots(response.data)
      setSnapshotError('')
    }).catch((caught: unknown) => { if (active) setSnapshotError(caught instanceof Error ? caught.message : '結果の履歴を確認できませんでした') })
      .finally(() => { if (active) setSnapshotLoading(false) })
    return () => { active = false }
  }, [accountId, selectedId, snapshotReload])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const visibleItems = useMemo(() => items.filter((item) => `${item.name} ${item.createdByName}`.toLowerCase().includes(query.trim().toLowerCase())), [items, query])
  // 絞り込みで選んだ項目が見えなくなったら、見えている先頭へ選び直す。0件なら選択を外す。
  useEffect(() => {
    if (!visibleItems.some((item) => item.id === selectedId)) setSelectedId(visibleItems[0]?.id ?? '')
  }, [visibleItems, selectedId])
  // 「定義が古い」は版ずれだけを数える（未取得・失敗とは別の軸）。
  const staleCount = items.filter((item) => item.latestSnapshot?.definitionStale).length
  const exportSaved = () => downloadCsv('analytics-saved.csv', [
    ['分析名', '種類', '作った人', '定義版', '更新日時', '集計状態', '保存結果数'],
    ...visibleItems.map((item) => [
      item.name, kindLabel(item.kind), item.createdByName, item.currentVersionNumber, item.updatedAt,
      item.latestSnapshot ? `${SAVED_STATE_LABELS[item.latestSnapshot.state]}${item.latestSnapshot.definitionStale ? '（旧版の結果・更新後未集計）' : ''}` : null,
      item.snapshotCount,
    ]),
  ])
  const exportSnapshots = () => {
    if (!selected) return
    downloadCsv(`analytics-saved-${selected.id}.csv`, [
      ['対象期間', 'データ締切', '集計状態', '結果の要約'],
      ...snapshots.map((snapshot) => [
        `${snapshot.periodFrom}〜${snapshot.periodTo}`, snapshot.dataCutoffAt, SAVED_STATE_LABELS[snapshot.state],
        summarizeSnapshotResult(snapshot.result, 6).map((row) => `${row.path || '結果'}: ${row.text}`).join(' / ').slice(0, 200),
      ]),
    ])
  }
  const exportDisabled = visibleItems.length === 0
  useRegisterExport(exportSaved, exportDisabled)
  const menu = (title: string) => <KpiMenu title={title} onExport={exportSaved} disabled={exportDisabled} />
  const failed = error ? '読み込めませんでした' : null
  const crossCount = items.filter((item) => item.kind === 'cross').length

  return <>
    <KpiBand className={styles.band}>
      <KpiCard presentation="band" title="保存した分析" icon={<Bookmark size={13} aria-hidden="true" />} menu={menu('保存した分析')} value={error ? null : items.length} unit="件" detail={failed ?? `クロス分析 ${crossCount}・ファネル ${items.length - crossCount}`} loading={loading} />
      <KpiCard presentation="band" title="保存結果数" icon={<History size={13} aria-hidden="true" />} menu={menu('保存結果数')} value={error ? null : items.reduce((sum, item) => sum + item.snapshotCount, 0)} unit="件" detail={failed ?? '時点ごとに固定した結果'} loading={loading} />
      <KpiCard presentation="band" title="定期レポート" icon={<Mail size={13} aria-hidden="true" />} menu={menu('定期レポート')} value={error || schedulesError ? null : schedules.length} unit="件" detail={error || schedulesError ? '読み込めませんでした' : `動いている ${schedules.filter((item) => item.status === 'active').length}・止めている ${schedules.filter((item) => item.status === 'paused').length}`} loading={loading || schedulesLoading} />
      <KpiCard presentation="band" title="定義が古いもの" icon={<AlertTriangle size={13} aria-hidden="true" />} menu={menu('定義が古いもの')} value={error ? null : staleCount} unit="件" detail={failed ?? '更新後まだ集計していない'} loading={loading} />
    </KpiBand>
    <div className={styles.body} data-gap="tab">
      <div className={styles.toolbar}>
        <div className={styles.searchBox} data-w="saved"><SearchField id="saved-analysis-search" aria-label="分析名・作った人で探す" value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder="分析名・作った人で探す" /></div>
        <span className={styles.spacer} />
        <span className={styles.caption} title="あとから条件が変わっても、保存時点の結果は書き換わりません。定期レポートは下の一覧で止めたり変えたりできます。">条件の定義と集計結果を分けて保存しています</span>
      </div>
      {loading ? <ListState kind="loading" title="保存した分析を読み込んでいます" />
        : error && items.length === 0 ? <ListState kind="error" title="保存した分析を読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。" onRetry={() => setSavedReload((n) => n + 1)} />
        : items.length === 0 ? <ListState kind="empty" title="保存した分析はまだありません" description="クロス分析かファネルを集計し、その結果を保存してください。" />
        : <div className={styles.routesSplit}>
          <div className={styles.routesMain}>
            <div className={styles.table} role="table" aria-label="保存した分析">
              <div className={styles.thead} role="row">
                <span role="columnheader" className={styles.colMain}>分析名</span>
                <span role="columnheader" className={styles.colType} data-w="90">種類</span>
                <span role="columnheader" className={styles.colType} data-w="80">作った人</span>
                <span role="columnheader" className={styles.colType} data-w="100">更新日時</span>
                <span role="columnheader" className={styles.colType} data-w="100">集計状態</span>
              </div>
              {visibleItems.length === 0
                ? <div className={styles.emptyRow} role="row"><span role="cell">条件に合う保存済み分析はありません。<button type="button" className={styles.linkButton} onClick={() => setQuery('')}>キャンセル</button></span></div>
                : visibleItems.map((item) => {
                  const active = selectedId === item.id
                  return <div key={item.id} className={styles.trow} role="row" data-h="pill" data-selected={active || undefined}>
                    <span role="cell" className={styles.colMain}><button type="button" className={styles.rowButton} onClick={() => setSelectedId(item.id)} title={`${item.name}（第${item.currentVersionNumber}版・保存結果 ${item.snapshotCount}件）`} aria-pressed={active}>{item.name}</button></span>
                    <span role="cell" className={styles.colType} data-w="90"><span>{kindLabel(item.kind)}</span></span>
                    <span role="cell" className={styles.colType} data-w="80"><span className={styles.cellText} title={item.createdByName}>{item.createdByName}</span></span>
                    <span role="cell" className={styles.colType} data-w="100"><span>{shortDateTime(item.updatedAt)}</span></span>
                    <span role="cell" className={styles.colType} data-w="100" title={item.latestSnapshot ? `${formatAnalyticsDate(item.latestSnapshot.periodFrom)}〜${formatAnalyticsDate(item.latestSnapshot.periodTo)}・${SAVED_STATE_LABELS[item.latestSnapshot.state]}` : undefined}><span>{latestPill(item)}</span></span>
                  </div>
                })}
            </div>
          </div>
          <section className={styles.historyCard} aria-labelledby="saved-history-title">
            <h2 id="saved-history-title" className={styles.hoursTitle} title={selected ? `定期レポート ${schedulesLoading ? '確認中' : schedulesError ? '—' : `${schedules.filter((schedule) => schedule.savedAnalysisIds.includes(selected.id)).length}件`}` : undefined}>{selected ? `選んだ分析の履歴：${selected.name}` : '選んだ分析の履歴'}</h2>
            {/* 履歴だけ取れないときは、その場所に小さく1行。一覧の失敗とは分ける。 */}
            {snapshotError ? <p className={styles.caption} role="alert">結果の履歴を読み込めませんでした。<button type="button" className={styles.linkButton} onClick={() => setSnapshotReload((n) => n + 1)}>もう一度</button></p> : null}
            {snapshotLoading ? <p className={styles.caption}>結果を読み込んでいます</p>
              : !selected ? <p className={styles.caption}>一覧から分析を選んでください</p>
              : snapshots.length === 0 ? <p className={styles.caption}>保存された結果はありません</p>
              : <div className={styles.table} role="table" aria-label="結果の履歴">
                <div className={styles.thead} role="row">
                  <span role="columnheader" className={styles.colMain}>対象期間</span>
                  <span role="columnheader" className={styles.colType} data-w="100">データ締切</span>
                  <span role="columnheader" className={styles.colType} data-w="60">状態</span>
                  <span role="columnheader" className={styles.colType} data-w="90">結果</span>
                </div>
                {snapshots.map((snapshot) => <div key={snapshot.id} className={styles.trow} role="row" data-h="button">
                  <span role="cell" className={styles.colMain} title={`${formatAnalyticsDate(snapshot.periodFrom)}〜${formatAnalyticsDate(snapshot.periodTo)}・${kindLabel(snapshot.sourceKind)}`}><span>{periodShort(snapshot.periodFrom, snapshot.periodTo)}</span></span>
                  <span role="cell" className={styles.colType} data-w="100"><span title={formatAnalyticsDateTime(snapshot.dataCutoffAt)}>{shortDateTime(snapshot.dataCutoffAt).replace(/ 0(\d):/, ' $1:')}</span></span>
                  <span role="cell" className={styles.colType} data-w="60"><span>{SAVED_STATE_LABELS[snapshot.state]}</span></span>
                  <span role="cell" className={styles.colType} data-w="90"><span><Button variant="secondary" onClick={() => setOpenSnapshot(snapshot)}>結果を見る</Button></span></span>
                </div>)}
              </div>}
            {selected ? <div className={styles.rowActions} data-gap="wide">
              <Button variant="secondary" disabled={snapshots.length === 0} onClick={exportSnapshots}><Download size={15} aria-hidden="true" />CSV で書き出す</Button>
              {canManage ? <Button variant="secondary" href={`/analytics?tab=${selected.kind}`} title="条件を変えるときは、元の分析で集計し直してから保存します"><FilePen size={15} aria-hidden="true" />内容を変える</Button> : null}
            </div> : null}
            <p className={styles.caption}>保存時点の固定結果です。いま集計し直しても変わりません。</p>
          </section>
        </div>}

      <div className={styles.sectionHead}>
        <h2 className={styles.hoursTitle}>定期レポート</h2>
        <span className={styles.caption}>決まった曜日や日に、集計結果をメールやLINEへ届けられます。</span>
        <span className={styles.spacer} />
        {schedulesLoading ? <span className={styles.caption}>確認中</span> : null}
        {canManage ? <Button href="/analytics/reports/new" variant="secondary"><Plus size={15} aria-hidden="true" />定期レポートを作る</Button> : null}
      </div>
      {schedulesError ? <div className={styles.inlineError} role="alert"><span>{schedulesError}</span>
        {/* 版ずれの通知は reloadSchedules で消さない。消すのは手でやり直したこの入口だけ。 */}
        <Button variant="secondary" disabled={schedulesLoading} onClick={() => { setSchedulesError(''); reloadSchedules() }}>もう一度確認</Button></div> : null}
      {schedulesLoading ? null : schedules.length === 0 ? (schedulesError ? null : <ListState kind="empty" title="定期レポートはまだありません" description="決まった曜日や日に、集計結果をメールやLINEへ届けられます。" />)
        : <div className={styles.table} role="table" aria-label="定期レポート">
          <div className={styles.thead} role="row">
            <span role="columnheader" className={styles.colMain}>レポート名</span>
            <span role="columnheader" className={styles.colType} data-w="90">間隔</span>
            <span role="columnheader" className={styles.colType} data-w="130">次に届く予定</span>
            <span role="columnheader" className={styles.colType} data-w="90">状態</span>
            <span role="columnheader" className={styles.colOps}>操作</span>
          </div>
          {schedules.map((schedule) => <div key={schedule.id} className={styles.trow} role="row" data-h="button">
            <span role="cell" className={styles.colMain}><span className={styles.cellText} title={schedule.name}>{schedule.name}</span></span>
            <span role="cell" className={styles.colType} data-w="90"><span>{schedule.isOneTime ? '1回だけ' : cadenceLabel(schedule)}</span></span>
            <span role="cell" className={styles.colType} data-w="130"><span>{schedule.status === 'paused' ? '—' : shortDateTime(schedule.nextRunAt).replace(/ 0(\d):/, ' $1:')}</span></span>
            <span role="cell" className={styles.colType} data-w="90"><span><StatePill tone={schedule.status === 'active' ? 'ok' : 'neutral'}>{REPORT_STATUS_LABELS[schedule.status]}</StatePill></span></span>
            <span role="cell" className={styles.colOps}>{canManage ? <span className={styles.rowActions}>
              {schedule.status === 'active' && !schedule.isOneTime ? <Button variant="secondary" disabled={scheduleBusyId === schedule.id} onClick={() => void changeScheduleStatus(schedule, 'paused')}>止める</Button> : null}
              {schedule.status === 'paused' ? <Button variant="secondary" disabled={scheduleBusyId === schedule.id} onClick={() => void changeScheduleStatus(schedule, 'active')}>また送る</Button> : null}
              {!schedule.isOneTime ? <Button variant="secondary" disabled={scheduleBusyId === schedule.id} onClick={() => setArchiveTarget(schedule)}>しまう</Button> : null}
              {!schedule.isOneTime ? <Button variant="secondary" href={`/analytics/reports/new?id=${schedule.id}`}>内容を変える</Button> : null}
            </span> : null}</span>
          </div>)}
        </div>}

      {/* 1回だけ送った直近の結果。一覧からは消えるため、ここから失敗理由・宛先別結果へ進める。 */}
      {recentOneTime.length > 0 ? <section className={styles.table} aria-label="1回だけ送った結果">
        <div className={styles.thead}><span className={styles.colMain}>{`1回だけ送った結果（${recentOneTime.length}件）`}</span></div>
        {recentOneTime.map((item) => <div key={item.schedule.id} className={styles.trow} data-h="button">
          <span className={styles.colMain}><strong className={styles.cellStrong} title={item.schedule.name}>{item.schedule.name}</strong><span className={styles.cellSub}>{item.lastRun ? `${RUN_STATE_LABELS[item.lastRun.state] ?? item.lastRun.state}${runErrorLabel(item.lastRun.errorCode, item.lastRun.state) ? `：${runErrorLabel(item.lastRun.errorCode, item.lastRun.state)}` : ''}` : 'まだ送信されていません'}</span></span>
          <span className={styles.colOps}><Button href={`/analytics/reports/new?id=${item.schedule.id}`} variant="secondary">結果を見る</Button></span>
        </div>)}
      </section> : null}
    </div>
    <ConfirmDialog
      open={archiveTarget !== null}
      title="定期レポートをしまいますか"
      description={archiveTarget ? `「${archiveTarget.name}」をしまうと、一覧から消えて今後の送信も止まります。` : ''}
      confirmLabel="しまう"
      destructive
      busy={archiveTarget !== null && scheduleBusyId === archiveTarget.id}
      onConfirm={() => { if (archiveTarget) void changeScheduleStatus(archiveTarget, 'archived') }}
      onCancel={() => setArchiveTarget(null)}
    />
    <Dialog open={openSnapshot !== null} title="この時点の結果" description={openSnapshot ? `${formatAnalyticsDate(openSnapshot.periodFrom)}〜${formatAnalyticsDate(openSnapshot.periodTo)}・データ締切 ${formatAnalyticsDateTime(openSnapshot.dataCutoffAt)}・${SAVED_STATE_LABELS[openSnapshot.state]}` : undefined} confirmLabel="閉じる" onConfirm={() => setOpenSnapshot(null)} onCancel={() => setOpenSnapshot(null)}>
      {openSnapshot ? (() => {
        const rows = summarizeSnapshotResult(openSnapshot.result)
        return <dl className={styles.resultList}>
          {rows.length === 0 ? <div><dt>結果</dt><dd>保存された数値はありません</dd></div> : rows.map((row, index) => <div key={index}><dt title={row.path}>{row.path || '結果'}</dt><dd>{row.text}</dd></div>)}
          <p className={styles.caption}>保存時点の固定結果です。いま集計し直しても変わりません。</p>
        </dl>
      })() : null}
    </Dialog>
  </>
}
