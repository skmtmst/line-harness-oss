'use client'
import React, { Suspense, useEffect, useState, type ReactNode } from 'react'
import EmergencyScreen from '@/v8/settings/emergency/screen'
import EmergencyControlV8 from './control-v8'
import Select from '@/components/shared/select'
import Link from 'next/link'
import Notice from '@/components/shared/notice'
import KpiCollapse from '@/components/ui/kpi-collapse'
import { api, type OperationHistoryEntry } from '@/lib/api'
import { formatOperationDate } from '@/lib/operation-status'
import { formatMinutesRough } from '@/lib/format-duration'
import { CAPABILITY_LABEL } from './restore-drift'
import releaseLog from '@/generated/release-log-summary.json'
import { collectRecentUpdates, RECENT_UPDATES_LIMIT, releaseEntryCount, type UpdateRelease } from './update-history'
const HISTORY_FETCH_LIMIT = 200


function SummaryCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-hairline rounded-card border bg-canvas p-4">
      <p className="text-ink-faint text-micro font-semibold">{label}</p>
      <p className="text-ink mt-1 text-base font-bold">{value}</p>
      <p className="text-ink-faint mt-1 text-xs">{note}</p>
    </div>
  )
}


function OperationSideCard({
  title,
  tone = 'plain',
  children,
}: {
  title: string
  tone?: 'plain' | 'warning'
  children: ReactNode
}) {
  return (
    <section className={`rounded-card border p-4 ${tone === 'warning' ? 'border-warning bg-warning-bg text-warning' : 'border-hairline bg-canvas text-ink-secondary'}`}>
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-3 space-y-3 text-xs leading-relaxed">{children}</div>
    </section>
  )
}


function HistoryPanel() {
  const [history, setHistory] = useState<OperationHistoryEntry[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [period, setPeriod] = useState<'year' | '30days'>('year')

  useEffect(() => {
    let cancelled = false
    api.operations.history(HISTORY_FETCH_LIMIT)
      .then((response) => {
        if (cancelled) return
        if (response.success && Array.isArray(response.data)) { setHistory(response.data); setState('ready') }
        else setState('error')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  const cutoff = Date.now() - (period === '30days' ? 30 : 365) * 24 * 60 * 60 * 1000
  const operations = history.filter((item) => item.historyKind !== 'deployment')
  const deployments = history.filter((item) => item.historyKind === 'deployment' && item.deployment)
  /*
   * 日付が読めない記録は期間外と別に数える(#518 10)。
   *
   * 以前は `NaN >= cutoff` が偽になり、黙って一覧から落ちていた。
   * 「履歴なし」と「記録が壊れて見えない」の区別が付かないのは、
   * 監査の記録では見逃せない。
   */
  const unreadableEntries = operations.filter((item) => Number.isNaN(Date.parse(item.createdAt)))
  const entries = operations.filter((item) => Date.parse(item.createdAt) >= cutoff)
  /*
   * 一覧・回数・最長停止は同じ期間で数える(N-454)。
   *
   * 以前は一覧だけ期間で絞り、概要は取得分すべて(最大200件)を数えていた。
   * 表示期間と食い違い、200件で打ち切られた総数を「全部」として見せていた。
   * 打ち切りが起きたときは「以上」を付けて総数を誤表示しない。
   */
  const truncated = history.length >= HISTORY_FETCH_LIMIT
  const longestMinutes = entries.reduce((longest, item) => {
    if (!item.stoppedAt || !item.resolvedAt) return longest
    return Math.max(longest, Math.round((Date.parse(item.resolvedAt) - Date.parse(item.stoppedAt)) / 60_000))
  }, 0)
  const releases = (releaseLog as { releases?: UpdateRelease[] }).releases ?? []
  const releaseUpdateCount = releases.filter((item) => item.released && Date.parse(item.released) >= Date.now() - 30 * 24 * 60 * 60 * 1000).reduce((sum, item) => sum + releaseEntryCount(item), 0)
  const deployedVersion = deployments.find((item) => item.deployment?.phase === 'succeeded' && item.deployment.version)?.deployment?.version
  const currentVersion = deployedVersion ?? releases.find((item) => item.released)?.version ?? '—'
  const updateCount = deployments.length > 0 ? deployments.filter((item) => Date.parse(item.occurredAt ?? item.createdAt) >= Date.now() - 30 * 24 * 60 * 60 * 1000).length : releaseUpdateCount
  /*
   * 「管理画面の更新」欄(OPERATIONS-01)。
   *
   * 以前は案内が「新しい10件」なのに `.slice(0, 4)` で4件しか出さず、
   * 5件目以降があることも分からなかった。件数は RECENT_UPDATES_LIMIT に
   * まとめ、案内文・行数・「続きがあります」の表示を同じ定数で揃える。
   * まだ画面に入っていない変更は行に混ぜず、件数だけ別に案内する。
   */
  const { updates: allUpdates, pendingCount: pendingUpdateCount, totalCount: allUpdateCount } = collectRecentUpdates(deployments, releases)
  const recentUpdates = allUpdates.slice(0, RECENT_UPDATES_LIMIT)
  const hiddenUpdateCount = allUpdateCount - recentUpdates.length

  const downloadCsv = () => {
    /**
     * 数式インジェクション対策(#518 中3)。
     *
     * 停止理由・補足・担当者は運用者の自由文で、先頭が `= + - @` のまま
     * Excel で開くと数式として実行され得る。先頭に `'` を付けて無害化する
     * (成果地点の書き出し `csvCell` と同じ約束)。
     */
    const quote = (value: unknown) => {
      const raw = String(value ?? '')
      const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
      return `"${safe.replaceAll('"', '""')}"`
    }
    const rows = entries.map((item) => [
      item.createdAt,
      item.actorId,
      item.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・'),
      item.lineAccountId ?? 'すべてのアカウント',
      item.reason,
      item.resolvedAt ?? '',
    ])
    const blob = new Blob([`\uFEFF${[['いつ・だれが', '担当者', '止めたもの', '対象', '理由', '戻した'], ...rows].map((row) => row.map(quote).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'operation-history.csv'; anchor.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4" data-design="V3 Update history">
      <div className="flex flex-wrap justify-end gap-2">
        <Select aria-label="表示期間" value={period} onChange={(value) => setPeriod(value as typeof period)} options={[{ value: 'year', label: 'この1年' }, { value: '30days', label: 'この30日' }]} />
        <button type="button" onClick={downloadCsv} className="rounded-control min-h-9 px-3 text-xs font-semibold text-action hover:bg-action-soft">CSVで書き出す</button>
      </div>
      {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
      <KpiCollapse data-ro-kpis="true" gridClassName="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="止めた回数" value={state === 'ready' ? `${entries.length}回${truncated ? '以上' : ''}` : '—'} note={period === '30days' ? 'この30日' : 'この1年'} />
        <SummaryCard label="いちばん長かった停止" value={longestMinutes > 0 ? formatMinutesRough(longestMinutes) : '—'} note={truncated ? '直近の記録から' : period === '30days' ? 'この30日' : 'この1年'} />
        <SummaryCard label="管理画面の更新" value={`${updateCount}回`} note="この30日" />
        <SummaryCard label="いまの版" value={currentVersion} note="反映済み" />
      </KpiCollapse>
      <Notice tone="info">止めた・戻した記録です。だれが、いつ、何を止めたかが残ります。通常の管理者は消せません。</Notice>
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
            <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">止めた・戻した記録</h2><p className="mt-0.5 text-xs text-ink-faint">だれが・いつ・何を・なぜ。サーバーに追記して残します</p>{unreadableEntries.length > 0 ? <p className="mt-1 text-xs font-semibold text-warning">日付が読めない記録が{unreadableEntries.length}件あり、期間の絞り込みから外しています。履歴なしとは扱いません。</p> : null}</div>
            {state === 'loading' ? <p className="p-8 text-center text-xs text-ink-faint">記録を読み込んでいます…</p> : state === 'error' ? <p className="bg-warning-bg px-4 py-4 text-xs font-medium text-warning">緊急操作の履歴を取得できませんでした。履歴なしとは扱いません。</p> : entries.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">この期間の記録はありません。</p> : <><div className="hidden grid-cols-[170px_1.2fr_1fr_1fr_100px] gap-3 bg-canvas-sunken px-4 py-3 text-micro font-semibold text-ink-faint md:grid"><span>いつ・だれが</span><span>止めたもの</span><span>対象</span><span>理由</span><span>戻した</span></div><div className="divide-y divide-hairline">{entries.map((entry) => <div key={entry.id} className="grid gap-3 px-4 py-4 md:grid-cols-[170px_1.2fr_1fr_1fr_100px] md:items-center"><div><time className="text-sm font-semibold text-ink">{formatOperationDate(entry.createdAt)}</time><p className="mt-1 truncate text-xs text-ink-faint" title={entry.actorId}>{entry.actorId}</p></div><p className="text-xs font-medium text-ink-secondary">{entry.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・')}</p><p className="text-xs text-ink-secondary">{entry.lineAccountId ?? 'すべてのアカウント'}</p><div><p className="text-xs font-medium text-ink-secondary">{entry.reason}</p>{entry.detail && <p className="mt-1 text-xs text-ink-faint">{entry.detail}</p>}</div><p className={`text-xs font-medium ${entry.resolvedAt ? 'text-success' : entry.status === 'failed' ? 'text-danger' : 'text-ink-faint'}`}>{entry.resolvedAt ? formatOperationDate(entry.resolvedAt) : entry.status === 'failed' ? '失敗' : '停止中'}</p></div>)}</div></>}
          </section>
          <section className="border-hairline rounded-card overflow-hidden border bg-canvas">
            <div className="border-hairline border-b px-4 py-3"><h2 className="text-base font-bold text-ink">管理画面の更新</h2><p className="mt-0.5 text-xs text-ink-faint">管理画面へ入った変更のうち、新しい{RECENT_UPDATES_LIMIT}件を表示します</p></div>
            {recentUpdates.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">更新の記録はありません。</p> : <div className="divide-y divide-hairline">{recentUpdates.map((entry, index) => <div key={`${entry.version}-${entry.pr ?? index}-${entry.at ?? index}`} className="grid gap-2 px-4 py-3 md:grid-cols-[140px_minmax(0,1fr)_90px] md:items-center"><div><time className="text-xs font-medium text-ink-secondary">{formatOperationDate(entry.at ?? entry.released)}</time><p className="mt-1 text-micro text-ink-faint">{entry.version}</p></div><p className="line-clamp-2 text-xs leading-relaxed text-ink-secondary" title={entry.text}>{entry.text}</p><p className="text-xs font-medium text-ink-faint">{entry.by ?? '自動'}{entry.pr ? ` #${entry.pr}` : ''}</p></div>)}</div>}
            {(hiddenUpdateCount > 0 || pendingUpdateCount > 0) && <div className="border-hairline space-y-1 border-t px-4 py-3 text-xs text-ink-faint">
              {hiddenUpdateCount > 0 && <p>続きが{hiddenUpdateCount}件あります。この欄では新しい{RECENT_UPDATES_LIMIT}件までを表示します。</p>}
              {pendingUpdateCount > 0 && <p>まだ画面に入っていない変更が{pendingUpdateCount}件あります。更新回数には含めていません。</p>}
            </div>}
          </section>
        </div>
        <aside className="w-full space-y-4 xl:w-96 xl:shrink-0">
          <OperationSideCard title="この記録でできること">
            <p><strong>「あの日 何が起きたか」をさかのぼれます</strong><br />止めた理由と、そのとき動いていたものが残ります。</p>
            <p><strong>だれが止めたかが分かります</strong><br />名前・場所・端末をサーバーの記録で確認します。</p>
            <p><strong>通常の管理者は消せません</strong></p>
          </OperationSideCard>
          <OperationSideCard title="つながる先">
            <p><Link href="/emergency?tab=control" className="font-bold text-action hover:underline focus-visible:underline">→ 緊急コントロール</Link><br />止める・戻す</p>
            <p><Link href="/staff" className="font-bold text-action hover:underline focus-visible:underline">→ ログインユーザー</Link><br />入った記録と担当者</p>
            <p><Link href="/broadcasts" className="font-bold text-action hover:underline focus-visible:underline">→ 一斉配信</Link><br />下書きに戻った配信</p>
          </OperationSideCard>
          <OperationSideCard title="気をつけること" tone="warning">
            <p><strong>止めているあいだの配信は出ません</strong><br />戻しても、そのぶんはさかのぼって送りません。</p>
            <p><strong>期限を過ぎた予約配信は戻りません</strong></p>
          </OperationSideCard>
        </aside>
      </div>
    </div>
  )
}
function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
    <EmergencyScreen renderControl={(accounts, controlRef) => <EmergencyControlV8 ref={controlRef} accounts={accounts} />} />
  </Suspense>
}
EmergencyPage.__test = { HistoryPanel }
export default EmergencyPage
