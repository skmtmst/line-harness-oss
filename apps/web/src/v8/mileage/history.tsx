'use client'

import { describeApiFailure } from '@/components/shared/api-error-message'
import { viewName, isGranted, PRESETS, monthStart, daysAgo } from './history-model'
import { validateHistoryPeriod } from './history-period'
import DateField from '@/components/shared/date-field'
import Select from '@/components/shared/select'
import { useListUrlValue } from '@/components/shared/list-url-state'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { CircleDot, Download, Plus, Undo2 } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  type MileageAdminHistory,
  type MileageAdminHistoryItem,
  type MileageHistoryItem,
} from '@/lib/api'

import { csvCell } from '@/lib/presentation'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { mileagePaginationTotal } from './display'
import HistoryTable from './history-table'
import HistoryStats from './history-stats'
import HistoryPager from './history-pager'
import { MileageFrame, useMileageShell } from './frame'
import { MileageToolbar, PerPageSelect, RetryButton, SavedSelect, StateCard, ToolbarNotices } from './parts'
import styles from './mileage.module.css'
import { Field } from '@/components/shared/form-controls'
import { csvFileName } from '@/lib/csv-file-name'

import { SaveErrorField } from '@/components/shared/save-form-errors'

export default function HistoryTab() {
  const { readonly, narrow } = useMileageShell()
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const requestRef = useRef(0)
  const [result, setResult] = useState<MileageAdminHistory | null>(null)
  const [periodResult, setPeriodResult] = useState<MileageAdminHistory | null>(null)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [exportError, setExportError] = useState('')
  const [pendingAction, setPendingAction] = useState<{ kind: 'confirm' | 'void'; item: MileageAdminHistoryItem } | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState('')
  const [searchInput, setSearchInput] = useListUrlValue('q', '')
  const [search, setSearch] = useListUrlValue('q', '')
  const [grantedOnly, setGrantedOnly] = useListUrlValue('grantedOnly', false)
  const [spentOnly, setSpentOnly] = useListUrlValue('spentOnly', false)
  const [preset, setPreset] = useState('all')
  const [customFrom, setCustomFrom] = useListUrlValue('from', '')
  const [to, setTo] = useListUrlValue('to', '')
  const [customEntryType, setCustomEntryType] = useListUrlValue<MileageHistoryItem['entryType'] | ''>('entryType', '')
  const [customStatus, setCustomStatus] = useListUrlValue<MileageHistoryItem['status'] | ''>('status', '')
  const [customMode, setCustomMode] = useListUrlValue<'automatic' | 'manual' | ''>('mode', '')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterDraft, setFilterDraft] = useState({ from: '', to: '', entryType: '', status: '', mode: '' })
  const [filterError, setFilterError] = useState<string | null>(null)
  const [inputRejected, setInputRejected] = useState<string | null>(null)
  const [pageSize, setPageSize] = useListUrlValue('pageSize', 20)
  const [page, setPage] = useListUrlValue('page', 1)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const applyPreset = (value: string) => {
    if (value === 'custom') {
      setFilterDraft({ from: customFrom, to, entryType: customEntryType, status: customStatus, mode: customMode })
      setFilterError(null)
      setFilterOpen(true)
      return
    }
    setCustomFrom(''); setTo(''); setCustomEntryType(''); setCustomStatus(''); setCustomMode('')
    setPreset(value)
    setPage(1)
    setGrantedOnly(value === 'granted')
    setSpentOnly(value === 'spent')
  }
  const presetValue = customFrom || to || customEntryType || customStatus || customMode ? 'custom'
    : preset === 'all' && !grantedOnly && !spentOnly ? 'all'
    : preset !== 'all' ? preset
      : grantedOnly ? 'granted' : 'spent'

  const from = preset === 'month' ? monthStart() : preset === 'week' ? daysAgo(6) : customFrom
  const periodError = validateHistoryPeriod(from, to)
  const modeFilter: 'automatic' | 'manual' | undefined = preset === 'manual' ? 'manual' : customMode || undefined
  const entryTypeFilter: MileageHistoryItem['entryType'] | undefined = grantedOnly ? 'grant' : customEntryType || undefined

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError(false)
    setExportError('')
    setInputRejected(null)
    if (!selectedAccountId) {
      setResult(null); setPeriodResult(null); setLoadedAccountId(null); setLoading(false)
      return
    }
    if (validateHistoryPeriod(from, to)) {
      setResult(null); setPeriodResult(null); setLoading(false)
      return
    }
    try {
      const [response, period] = await Promise.all([api.mileage.history({
        accountId: selectedAccountId ?? '',
        search: search || undefined,
        entryType: entryTypeFilter,
        mode: modeFilter,
        from: from || undefined,
        to: to || undefined,
        status: customStatus || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }), api.mileage.history({ accountId: selectedAccountId ?? '', from: daysAgo(29), to: daysAgo(0), limit: 1, offset: 0 }).catch(() => null)])
      if (request !== requestRef.current) return
      if (!response.success) throw new Error(response.error)
      /* 「使った・取り消しのみ」は口に種類の絞り込みが無いので、付けた分を手元で除く。 */
      if (spentOnly) {
        response.data.items = response.data.items.filter((item) => !isGranted(item))
      }
      setPeriodResult(period?.success ? period.data : null)
      setResult(response.data)
      setLoadedAccountId(selectedAccountId)
    } catch (caught) {
      if (request !== requestRef.current) return
      setResult(null); setPeriodResult(null)
      if (caught instanceof ApiError && caught.status === 400) setInputRejected('入力した条件を確認してください。開始日は終了日より前の日付を入力してください。')
      else setError(true)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [entryTypeFilter, from, modeFilter, page, pageSize, search, selectedAccountId, spentOnly, to, customStatus])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const items = useMemo(() => result?.items ?? [], [result])
  const total = mileagePaginationTotal(result)
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize))
  const byType = periodResult?.summary.byType ?? []
  const countOf = (entryType: MileageHistoryItem['entryType']) =>
    byType.find((item) => item.entryType === entryType)?.count ?? 0
  const amountOf = (entryType: MileageHistoryItem['entryType']) =>
    byType.find((item) => item.entryType === entryType)?.amount ?? 0
  const grantedCount = countOf('grant')
  const reversalCount = countOf('reversal')

  const canExport = !accountLoading && !loading && !error && !!selectedAccountId
    && loadedAccountId === selectedAccountId && items.length > 0
  const exportCsv = useCallback(() => {
    if (!canExport) return
    setExportError('')
    try {
      const rows = items.map((item) => [
        item.occurredAt,
        viewName(item),
        item.amount,
        item.reason,
        item.balanceAfter ?? '',
        item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : '自動',
      ])
      const csv = [['日時', '友だち', '増減', '理由', '残高', 'だれが'], ...rows]
        .map((row) => row.map((value) => csvCell(value)).join(','))
        .join('\n')
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = csvFileName("マイル履歴")
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('CSVを書き出せませんでした。もう一度お試しください。')
    }
  }, [canExport, items])

  const runPendingAction = async () => {
    if (!pendingAction || pendingBusy || !selectedAccountId) return
    const reason = pendingReason.trim()
    if (!reason) {
      setPendingError('理由を入力してください。')
      return
    }
    setPendingBusy(true)
    setPendingError('')
    try {
      const response = pendingAction.kind === 'confirm'
        ? await api.mileage.confirmMileageEntry(pendingAction.item.id, { accountId: selectedAccountId, reason })
        : await api.mileage.voidMileageEntry(pendingAction.item.id, { accountId: selectedAccountId, reason })
      if (!response.success) throw new Error(response.error)
      setPendingAction(null)
      setPendingReason('')
      await load()
    } catch (caught) {
      setPendingError(describeApiFailure(caught, '保存'))
    } finally {
      setPendingBusy(false)
    }
  }

  const openPending = (kind: 'confirm' | 'void', item: MileageAdminHistoryItem) => {
    setPendingAction({ kind, item })
    setPendingReason('')
    setPendingError('')
  }

  const filtered = search.trim() || grantedOnly || spentOnly || preset !== 'all' || customFrom || to || customEntryType || customStatus || customMode
  const resetAll = () => {
    setCustomFrom(''); setTo(''); setCustomEntryType(''); setCustomStatus(''); setCustomMode('')
    setSearchInput('')
    setSearch('')
    setGrantedOnly(false)
    setSpentOnly(false)
    setPreset('all')
    setPage(1)
  }

  const ready = !loading && !error && periodResult !== null

  const stats = <HistoryStats title="直近30日の動き"
    ready={ready} total={mileagePaginationTotal(periodResult)} grantedCount={grantedCount}
    spendCount={countOf('spend')} reversalCount={reversalCount}
    manualCount={result?.summary.manualCount} pendingCount={result?.summary.pendingCount}
    grantAmount={amountOf('grant')} spendAmount={amountOf('spend')} />

  const chips = (
    <div role="group" aria-label="種類で絞り込む" className={styles.chipGroup}>
      <FilterChip
        selected={grantedOnly}
        icon={<CircleDot size={13} aria-hidden="true" />}
        onChange={(selected) => {
          setPreset('all')
          setPage(1)
          setGrantedOnly(selected)
          if (selected) setSpentOnly(false)
        }}
      >
        付けた
      </FilterChip>
      <FilterChip
        selected={spentOnly}
        icon={<Undo2 size={13} aria-hidden="true" />}
        onChange={(selected) => {
          setPreset('all')
          setPage(1)
          setSpentOnly(selected)
          if (selected) setGrantedOnly(false)
        }}
      >
        使った・取り消し
      </FilterChip>
    </div>
  )

  const toolbar = (
    <MileageToolbar
      narrow={narrow}
      notices={<ToolbarNotices error={exportError} />}
      search={{
        placeholder: '友だち・できごとで探す',
        value: searchInput,
        onChange: (value) => {
          setSearchInput(value)
          if (!value) { setSearch(''); setPage(1) }
        },
      }}
      chips={chips}
      trailing={<>
        <SavedSelect value={presetValue} options={PRESETS} onChange={applyPreset} />
        <PerPageSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} />
      </>}
    />
  )

  const table = <HistoryTable {...{ items, readonly, menuId, setMenuId, openPending, viewName }} />

  const body = !accountLoading && !selectedAccountId ? (
    <ListState kind="empty" title="LINEアカウントを選択してください" description="共通トップバーでLINEアカウントを選ぶと、マイルの履歴を確認できます。" />
  ) : loading ? (
    <ListState kind="loading" title="マイルの履歴を読み込んでいます" />
  ) : (periodError ?? inputRejected) ? (
    <StateCard title="日付の条件を確認してください" description={periodError ?? inputRejected ?? undefined} />
  ) : error ? (
    <StateCard tone="error" title="マイルの履歴を読み込めませんでした" description="数の帯は「—」にしています。道具はそのまま使えます。" action={<RetryButton onRetry={() => void load()} />} />
  ) : items.length === 0 ? (

    spentOnly && pageCount > 1 ? (
      <StateCard title="このページには、使った・取り消しの履歴がありません" description="この絞り込みは1ページずつ見ています。ほかのページにある場合があります。下のページ送りで確かめてください。" />
    ) : filtered ? (
      <StateCard title="条件に合う履歴はありません" description="検索や絞り込みを外すと、すべて出ます" action={<Button type="button" onClick={resetAll}>条件を外す</Button>} />
    ) : (
      <StateCard title="まだ履歴がありません" description="マイルを付けたり使ったりすると、ここに記録が残ります" />
    )
  ) : table


  const footer = !loading && !error && total !== null && (items.length > 0 || (spentOnly && pageCount > 1)) ? (
    <div className={styles.pagerStack}>
      <HistoryPager {...{ spentOnly, total, page, pageSize, items, pageCount, loading, setPage }} />
      {/* 行の操作の案内はページ送りの下の1行（絵 oRbJi の「下の段」）。 */}
      <p className={styles.footNoteFlush}>行を押すと、その友だちのマイルの詳細を開きます。「増やす・減らす」は理由を書いて明細を足します（オーナー・管理者だけ）。</p>
    </div>
  ) : undefined

  return (
    <MileageFrame
      explanation="明細はあとから消せません。間違えて付けたときは「減らす」で取り消しの明細を足します。"
      actions={<div className={styles.headActions}>
        <Button onClick={exportCsv} disabled={!canExport}>
          <Download size={15} aria-hidden="true" /> CSVで書き出す
        </Button>
        {/* 閲覧のみの人には出さない。 */}
        {!readonly ? (
          <Button href="/mileage?tab=balances" title="友だちを選んで増減します">
            <Plus size={15} aria-hidden="true" /> 増やす・減らす
          </Button>
        ) : null}
      </div>}
      stats={stats}
      toolbar={toolbar}
      pagination={footer}
      overlays={
        <>
        <Dialog open={filterOpen} title="履歴の条件を指定" confirmLabel="この条件で絞る" onCancel={() => setFilterOpen(false)} onConfirm={() => {
          const invalid = validateHistoryPeriod(filterDraft.from, filterDraft.to)
          if (invalid) { setFilterError(invalid); return }
          setPreset('all'); setGrantedOnly(false); setSpentOnly(false); setPage(1)
          setCustomFrom(filterDraft.from); setTo(filterDraft.to)
          setCustomEntryType(filterDraft.entryType as MileageHistoryItem['entryType'] | '')
          setCustomStatus(filterDraft.status as MileageHistoryItem['status'] | '')
          setCustomMode(filterDraft.mode as 'automatic' | 'manual' | '')
          setFilterOpen(false)
        }}>
          <div className={styles.dlgBody}>
            <Field label="開始日"><DateField aria-label="開始日" value={filterDraft.from} invalid={Boolean(filterError ?? periodError ?? inputRejected)} onChange={(value) => setFilterDraft((draft) => ({ ...draft, from: value }))} /></Field>
            <Field label="終了日"><DateField aria-label="終了日" value={filterDraft.to} invalid={Boolean(filterError ?? periodError ?? inputRejected)} onChange={(value) => setFilterDraft((draft) => ({ ...draft, to: value }))} /></Field>
            {(filterError ?? periodError ?? inputRejected) ? <Notice tone="danger">{filterError ?? periodError ?? inputRejected}</Notice> : null}
            <Select label="種類" aria-label="種類" value={filterDraft.entryType} options={[{ value: '', label: 'すべての種類' }, { value: 'grant', label: '付与' }, { value: 'reversal', label: '取消' }, { value: 'spend', label: '使用' }, { value: 'expiration', label: '失効' }, { value: 'adjustment', label: '手動調整' }]} onChange={(value) => setFilterDraft((draft) => ({ ...draft, entryType: value }))} />
            <Select label="状態" aria-label="状態" value={filterDraft.status} options={[{ value: '', label: 'すべての状態' }, { value: 'available', label: '利用可能' }, { value: 'pending', label: '確定待ち' }, { value: 'void', label: '取消済み' }]} onChange={(value) => setFilterDraft((draft) => ({ ...draft, status: value }))} />
            <Select label="動かした方法" aria-label="動かした方法" value={filterDraft.mode} options={[{ value: '', label: 'すべての方法' }, { value: 'automatic', label: '自動' }, { value: 'manual', label: '手動' }]} onChange={(value) => setFilterDraft((draft) => ({ ...draft, mode: value }))} />
          </div>
        </Dialog>
        <Dialog
          open={pendingAction !== null}
          title={pendingAction?.kind === 'confirm' ? 'このマイルを確定しますか？' : 'このマイルを取り消しますか？'}
          description={pendingAction?.kind === 'confirm'
            ? '確定待ちから利用可能に変わります。'
            : '取り消すと逆向きの記録が残ります。もとの記録そのものは消えません。'}
          tone={pendingAction?.kind === 'void' ? 'destructive' : 'default'}
          confirmLabel={pendingAction?.kind === 'confirm' ? '確定する' : '取り消す'}
          busy={pendingBusy}
          error={pendingError || undefined}
          onCancel={() => { if (!pendingBusy) setPendingAction(null) }}
          onConfirm={() => runPendingAction()}
        >
          <Field label="理由" required><SaveErrorField names={["pendingReason","pending_reason"]}><textarea
              className={styles.textarea}
              value={pendingReason}
              onChange={(event) => setPendingReason(event.target.value)}
              placeholder={pendingAction?.kind === 'confirm' ? '例：入金を確認しました' : '例：予約がキャンセルされました'}
              rows={3}
            /></SaveErrorField></Field>
        </Dialog>
        </>
      }
    >
      {body}
    </MileageFrame>
  )
}
